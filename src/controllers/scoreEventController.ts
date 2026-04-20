import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import { scoreMatchEvent } from '../services/scoreEventService';

const matchIdSchema = z.object({
  matchId: z.string().min(1)
});

const runSchema = z.object({
  type: z.literal('run'),
  runs: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(6)
  ])
});

const extraSchema = z.object({
  type: z.literal('extra'),
  extraType: z.enum(['wide', 'noBall', 'byes', 'legByes']),
  additionalRuns: z.number().int().min(0).default(0)
});

const wicketSchema = z
  .object({
    type: z.literal('wicket'),
    wicketType: z.enum([
      'bowled',
      'caught',
      'lbw',
      'stumping',
      'hitWicket',
      'runOut',
      'obstructingField'
    ]),
    extraType: z.enum(['wide', 'noBall', 'none']).optional().default('none'),
    newBatterId: z.string().trim().min(1).optional(),
    newBatterName: z.string().trim().min(1).optional(),
    fielderId: z.string().trim().min(1).optional(),
    runOutBatsman: z.enum(['striker', 'nonStriker']).optional(),
    runsWithWicket: z
      .union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6)
      ])
      .default(0)
  })
  .superRefine((value, ctx) => {
    if (
      value.wicketType === 'runOut' && !value.runOutBatsman
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'runOutBatsman is required for run out wicket types.',
        path: ['runOutBatsman']
      });
    }

    if (
      (value.wicketType === 'caught' ||
        value.wicketType === 'stumping' ||
        value.wicketType === 'runOut') &&
      !value.fielderId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fielderId is required for this wicket type.',
        path: ['fielderId']
      });
    }
  });

const swapSchema = z.object({
  type: z.literal('swap')
});

const retireSchema = z.object({
  type: z.literal('retire'),
  retiringBatter: z.enum(['striker', 'nonStriker']),
  newBatterId: z.string().trim().min(1).optional(),
  newBatterName: z.string().trim().min(1).optional(),
  reason: z.string().trim().optional()
}).superRefine((value, ctx) => {
  if (!value.newBatterId && !value.newBatterName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'newBatterId or newBatterName is required for retire.',
      path: ['newBatterId']
    });
  }
});

const undoSchema = z.object({
  type: z.literal('undo')
});

const scoreEventSchema = z.discriminatedUnion('type', [
  runSchema,
  extraSchema,
  wicketSchema,
  swapSchema,
  retireSchema,
  undoSchema
]);

const getAuth = (req: Request) => {
  const auth = req.auth;
  if (!auth) {
    throw new AppError('Auth context missing.', 401, 'auth.missing_context');
  }
  return auth;
};

export const scoreMatchEventHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { matchId } = matchIdSchema.parse(req.params);
    const payload = scoreEventSchema.parse(req.body);
    const auth = getAuth(req);

    const result = await scoreMatchEvent({
      tenantId: auth.tenantId,
      matchId,
      createdByUserId: auth.userId,
      ...payload
    });

    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

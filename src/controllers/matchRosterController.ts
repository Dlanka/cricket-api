import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import { getRosterByMatch, replaceRoster } from '../services/matchRosterService';

const matchIdSchema = z.object({
  matchId: z.string().min(1)
});

const rosterSchema = z.object({
  teamId: z.string().min(1),
  playingPlayerIds: z
    .array(z.string().min(1))
    .min(1, 'At least 1 player must be selected.')
    .max(11, 'At most 11 players can be selected.'),
  captainId: z.string().min(1).optional(),
  keeperId: z.string().min(1).optional()
});

const getTenantId = (req: Request) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
  }
  return tenantId;
};

export const replaceRosterHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { matchId } = matchIdSchema.parse(req.params);
    const input = rosterSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const result = await replaceRoster({ tenantId, matchId, ...input });
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getRosterHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { matchId } = matchIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const roster = await getRosterByMatch(tenantId, matchId);
    return res.status(200).json(ok(roster));
  } catch (error) {
    return next(error);
  }
};

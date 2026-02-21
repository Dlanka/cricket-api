import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { getMatchSummary } from '../services/matchSummaryService';
import { AppError } from '../utils/appError';
import { ok } from '../utils/apiResponse';

const matchIdSchema = z.object({
  matchId: z.string().min(1)
});

const getTenantId = (req: Request) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
  }

  return tenantId;
};

export const getMatchSummaryHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { matchId } = matchIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const summary = await getMatchSummary(tenantId, matchId);
    return res.status(200).json(ok(summary));
  } catch (error) {
    return next(error);
  }
};

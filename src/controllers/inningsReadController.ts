import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import {
  getBattersForInnings,
  getBowlersForInnings,
  getEventsForInnings,
  getOversForInnings
} from '../services/inningsReadService';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id format.');

const inningsIdParamSchema = z.object({
  inningsId: objectIdSchema
});

const oversQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10)
});

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  cursor: z.coerce.number().int().positive().optional()
});

const getTenantId = (req: Request) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
  }
  return tenantId;
};

export const getInningsBattersHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inningsId } = inningsIdParamSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await getBattersForInnings(tenantId, inningsId);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getInningsBowlersHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inningsId } = inningsIdParamSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await getBowlersForInnings(tenantId, inningsId);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getInningsOversHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inningsId } = inningsIdParamSchema.parse(req.params);
    const { limit } = oversQuerySchema.parse(req.query);
    const tenantId = getTenantId(req);
    const result = await getOversForInnings(tenantId, inningsId, limit);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getInningsEventsHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inningsId } = inningsIdParamSchema.parse(req.params);
    const { limit, cursor } = eventsQuerySchema.parse(req.query);
    const tenantId = getTenantId(req);
    const result = await getEventsForInnings(tenantId, inningsId, cursor ?? null, limit);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

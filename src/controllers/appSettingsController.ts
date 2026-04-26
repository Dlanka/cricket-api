import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import { getAppSettings, updateAppSettings } from '../services/appSettingsService';
import { ACTION_KEYS } from '../constants/authz';

const actionSchema = z.enum(ACTION_KEYS);

const updateAppSettingsSchema = z
  .object({
    organization: z
      .object({
        tenantName: z.string().trim().min(1).optional(),
        timezone: z.string().trim().min(1).optional(),
        locale: z.string().trim().min(1).optional(),
        dateFormat: z.string().trim().min(1).optional(),
        logoUrl: z.string().trim().url().nullable().optional()
      })
      .optional(),
    tournamentDefaults: z
      .object({
        defaultType: z.enum(['LEAGUE', 'KNOCKOUT', 'LEAGUE_KNOCKOUT', 'SERIES']).optional(),
        defaultOversPerInnings: z.coerce.number().int().min(1).optional(),
        defaultBallsPerOver: z.coerce.number().int().min(1).optional(),
        defaultQualificationCount: z.coerce.number().int().min(2).optional(),
        points: z
          .object({
            win: z.coerce.number().min(0).optional(),
            tie: z.coerce.number().min(0).optional(),
            noResult: z.coerce.number().min(0).optional(),
            loss: z.coerce.number().min(0).optional()
          })
          .optional()
      })
      .optional(),
    matchRules: z
      .object({
        allowUndo: z.boolean().optional(),
        maxUndoWindowSec: z.coerce.number().int().min(0).optional(),
        lockRosterAfterStart: z.boolean().optional(),
        lockMatchConfigAfterStart: z.boolean().optional(),
        requireBothRostersBeforeStart: z.boolean().optional()
      })
      .optional(),
    permissions: z
      .object({
        ADMIN: z.array(actionSchema).optional(),
        SCORER: z.array(actionSchema).optional(),
        VIEWER: z.array(actionSchema).optional()
      })
      .optional()
  })
  .refine(
    (data) =>
      data.organization !== undefined ||
      data.tournamentDefaults !== undefined ||
      data.matchRules !== undefined ||
      data.permissions !== undefined,
    { message: 'At least one settings section must be provided.' }
  );

const getTenantId = (req: Request) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
  }
  return tenantId;
};

export const getAppSettingsHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const settings = await getAppSettings(tenantId);
    return res.status(200).json(ok(settings));
  } catch (error) {
    return next(error);
  }
};

export const updateAppSettingsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const tenantId = getTenantId(req);
    const payload = updateAppSettingsSchema.parse(req.body);
    const settings = await updateAppSettings(tenantId, payload);
    return res.status(200).json(ok(settings));
  } catch (error) {
    return next(error);
  }
};

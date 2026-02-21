import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import { changeMyPassword, getMeSettings, updateMeSettings } from '../services/meSettingsService';

const getContext = (req: Request) => {
  const auth = req.auth;
  if (!auth) {
    throw new AppError('Auth context missing.', 401, 'auth.missing_context');
  }

  return {
    userId: auth.userId,
    tenantId: auth.tenantId,
    role: auth.role
  };
};

const updateMeSettingsSchema = z
  .object({
    profile: z
      .object({
        fullName: z.string().trim().min(1).optional()
      })
      .optional(),
    preferences: z
      .object({
        locale: z.string().trim().min(1).optional(),
        timezone: z.string().trim().min(1).optional(),
        dateFormat: z.string().trim().min(1).optional(),
        theme: z.enum(['light', 'dark', 'system']).optional(),
        notifications: z
          .object({
            email: z.boolean().optional(),
            inApp: z.boolean().optional()
          })
          .optional()
      })
      .optional()
  })
  .refine((data) => data.profile !== undefined || data.preferences !== undefined, {
    message: 'At least one settings section must be provided.'
  });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

export const getMeSettingsHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getMeSettings(getContext(req));
    return res.status(200).json(ok(data));
  } catch (error) {
    return next(error);
  }
};

export const updateMeSettingsHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = updateMeSettingsSchema.parse(req.body);
    const data = await updateMeSettings(getContext(req), payload);
    return res.status(200).json(ok(data));
  } catch (error) {
    return next(error);
  }
};

export const changeMyPasswordHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = changePasswordSchema.parse(req.body);
    const result = await changeMyPassword(getContext(req), payload);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

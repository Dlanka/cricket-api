import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/appError';

export const requireRole = (roles: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  const role = req.auth?.role;

  if (!role) {
    return next(new AppError('Role context missing.', 403, 'auth.missing_role'));
  }

  if (!roles.includes(role)) {
    return next(new AppError('Access denied.', 403, 'auth.forbidden'));
  }

  return next();
};

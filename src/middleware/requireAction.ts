import type { NextFunction, Request, Response } from 'express';
import type { ActionKey } from '../constants/authz';
import { getEffectivePermissions, canPerformAction } from '../services/authorizationService';
import { AppError } from '../utils/appError';

export const requireAction = (required: ActionKey) => async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const tenantId = req.auth?.tenantId;
    if (!tenantId) {
      return next(new AppError('Tenant context missing.', 403, 'auth.missing_tenant'));
    }

    const role = req.auth?.role;
    if (!role) {
      return next(new AppError('Role context missing.', 403, 'auth.missing_role'));
    }

    const permissions = await getEffectivePermissions(tenantId, role);
    if (canPerformAction(permissions, required)) {
      return next();
    }

    return next(
      new AppError('Missing required permission', 403, 'auth.forbidden', {
        required,
        role
      })
    );
  } catch (error) {
    return next(error);
  }
};

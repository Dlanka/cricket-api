import type { NextFunction, Request, Response } from 'express';
import type { ActionKey } from '../constants/authz';
import { AppError } from '../utils/appError';
import { getEffectivePermissions, canPerformAction } from '../services/authorizationService';
import { TenantModel } from '../models/tenant';
import { MembershipModel } from '../models/membership';

const resolveOwnerUserId = async (tenantId: string): Promise<string | null> => {
  const tenant = await TenantModel.findById(tenantId).select({ _id: 1, ownerUserId: 1 });
  if (!tenant) {
    throw new AppError('Tenant not found.', 404, 'tenant.not_found');
  }

  if (tenant.ownerUserId) {
    return tenant.ownerUserId.toString();
  }

  const firstAdminMembership = await MembershipModel.findOne({
    tenantId,
    role: 'ADMIN',
    status: 'ACTIVE'
  })
    .sort({ createdAt: 1 })
    .select({ userId: 1 });

  if (!firstAdminMembership) {
    return null;
  }

  tenant.ownerUserId = firstAdminMembership.userId;
  await tenant.save();
  return firstAdminMembership.userId.toString();
};

export const requireActionOrOwner = (required: ActionKey) => async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const auth = req.auth;
    if (!auth) {
      return next(new AppError('Auth context missing.', 401, 'auth.missing_context'));
    }

    const ownerUserId = await resolveOwnerUserId(auth.tenantId);
    if (ownerUserId !== null && auth.userId === ownerUserId) {
      return next();
    }

    const permissions = await getEffectivePermissions(auth.tenantId, auth.role);
    if (canPerformAction(permissions, required)) {
      return next();
    }

    return next(
      new AppError('Missing required permission', 403, 'auth.forbidden', {
        required,
        role: auth.role
      })
    );
  } catch (error) {
    return next(error);
  }
};

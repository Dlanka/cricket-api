import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import { requireAction } from '../middleware/requireAction';
import { TenantModel } from '../models/tenant';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import {
  assignTenantMemberHandler,
  listTenantMembersHandler,
  removeTenantMemberHandler,
  updateTenantMemberHandler
} from '../controllers/tenantMemberController';

export const tenantRoutes = Router();

tenantRoutes.get('/tenant/current', requireAuthApp, async (req, res, next) => {
  try {
    const tenantId = req.auth?.tenantId;

    if (!tenantId) {
      throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
    }

    const tenant = await TenantModel.findById(tenantId);

    if (!tenant) {
      throw new AppError('Tenant not found.', 404, 'tenant.not_found');
    }

    return res.status(200).json(ok({ id: tenant.id, name: tenant.name, status: tenant.status }));
  } catch (error) {
    return next(error);
  }
});

tenantRoutes.get('/tenant/members', requireAuthApp, requireAction('tournament.manage'), listTenantMembersHandler);
tenantRoutes.post('/tenant/members', requireAuthApp, requireAction('tournament.manage'), assignTenantMemberHandler);
tenantRoutes.patch(
  '/tenant/members/:membershipId',
  requireAuthApp,
  requireAction('tournament.manage'),
  updateTenantMemberHandler
);
tenantRoutes.delete(
  '/tenant/members/:membershipId',
  requireAuthApp,
  requireAction('tournament.manage'),
  removeTenantMemberHandler
);

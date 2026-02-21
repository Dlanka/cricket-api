import type { NextFunction, Request, Response } from 'express';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import { FUTURE_ADMIN_OPS_DEFAULT_ACTION } from '../constants/authz';
import {
  getActionCapabilities,
  getAuthzMatrix,
  getAuthorizationContractVersion,
  getEffectivePermissions
} from '../services/authorizationService';

const getAuthContext = (req: Request) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
  }

  const role = req.auth?.role;
  if (!role) {
    throw new AppError('Role context missing.', 403, 'auth.missing_role');
  }

  return { tenantId, role };
};

export const getMyPermissionsHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, role } = getAuthContext(req);
    const permissions = await getEffectivePermissions(tenantId, role);

    return res.status(200).json(
      ok({
        tenantId,
        role,
        permissions,
        version: getAuthorizationContractVersion()
      })
    );
  } catch (error) {
    return next(error);
  }
};

export const getCapabilitiesHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, role } = getAuthContext(req);
    const permissions = await getEffectivePermissions(tenantId, role);

    return res.status(200).json(
      ok({
        actions: getActionCapabilities(permissions)
      })
    );
  } catch (error) {
    return next(error);
  }
};

export const getAuthzMatrixHandler = (_req: Request, res: Response) => {
  return res.status(200).json(
    ok({
      version: getAuthorizationContractVersion(),
      policy: {
        futureAdminOpsDefaultAction: FUTURE_ADMIN_OPS_DEFAULT_ACTION
      },
      endpoints: getAuthzMatrix()
    })
  );
};

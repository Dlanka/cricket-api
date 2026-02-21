import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import { APP_ROLES } from '../constants/authz';
import {
  assignTenantMember,
  listTenantMembers,
  removeTenantMember,
  updateTenantMember
} from '../services/tenantMemberService';

const membershipStatusSchema = z.enum(['ACTIVE', 'DISABLED']);

const assignTenantMemberSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(APP_ROLES),
  status: membershipStatusSchema.optional()
});

const updateTenantMemberSchema = z
  .object({
    role: z.enum(APP_ROLES).optional(),
    status: membershipStatusSchema.optional()
  })
  .refine((data) => data.role !== undefined || data.status !== undefined, {
    message: 'At least one field must be provided.'
  });

const membershipIdSchema = z.object({
  membershipId: z.string().min(1)
});

const getTenantId = (req: Request) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
  }

  return tenantId;
};

export const listTenantMembersHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const members = await listTenantMembers(tenantId);
    return res.status(200).json(ok(members));
  } catch (error) {
    return next(error);
  }
};

export const assignTenantMemberHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const payload = assignTenantMemberSchema.parse(req.body);
    const membership = await assignTenantMember({ tenantId, ...payload });
    return res.status(201).json(ok(membership));
  } catch (error) {
    return next(error);
  }
};

export const updateTenantMemberHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const { membershipId } = membershipIdSchema.parse(req.params);
    const payload = updateTenantMemberSchema.parse(req.body);
    const membership = await updateTenantMember(tenantId, membershipId, payload);
    return res.status(200).json(ok(membership));
  } catch (error) {
    return next(error);
  }
};

export const removeTenantMemberHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const { membershipId } = membershipIdSchema.parse(req.params);
    const result = await removeTenantMember(tenantId, membershipId);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

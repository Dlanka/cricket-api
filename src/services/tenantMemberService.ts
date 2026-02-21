import { isValidObjectId } from 'mongoose';
import { MembershipModel } from '../models/membership';
import { TenantModel } from '../models/tenant';
import { UserModel } from '../models/user';
import { AppError } from '../utils/appError';
import type { AppRole } from '../constants/authz';

export type MembershipStatus = 'ACTIVE' | 'DISABLED';

export type AssignTenantMemberInput = {
  tenantId: string;
  email: string;
  role: AppRole;
  status?: MembershipStatus;
};

export type UpdateTenantMemberInput = {
  role?: AppRole;
  status?: MembershipStatus;
};

const ensureObjectId = (id: string, message: string) => {
  if (!isValidObjectId(id)) {
    throw new AppError(message, 400, 'validation.invalid_id');
  }
};

const ensureTenantExists = async (tenantId: string) => {
  const tenant = await TenantModel.findById(tenantId).select({ _id: 1, name: 1, status: 1, ownerUserId: 1 });
  if (!tenant) {
    throw new AppError('Tenant not found.', 404, 'tenant.not_found');
  }

  return tenant;
};

const resolveOwnerUserId = async (tenantId: string) => {
  const tenant = await ensureTenantExists(tenantId);
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

const toMemberResponse = (membership: {
  _id: { toString(): string };
  tenantId: { toString(): string };
  role: string;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
  userId: null | {
    _id: { toString(): string };
    email?: string;
    fullName?: string;
    status?: string;
  };
}) => ({
  membershipId: membership._id.toString(),
  tenantId: membership.tenantId.toString(),
  role: membership.role,
  status: membership.status,
  createdAt: membership.createdAt,
  updatedAt: membership.updatedAt,
  isOwner: false,
  user: membership.userId
    ? {
        id: membership.userId._id.toString(),
        email: membership.userId.email ?? null,
        fullName: membership.userId.fullName ?? null,
        status: membership.userId.status ?? null
      }
    : null
});

export const listTenantMembers = async (tenantId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  const ownerUserId = await resolveOwnerUserId(tenantId);

  const memberships = await MembershipModel.find({ tenantId })
    .populate('userId', { _id: 1, email: 1, fullName: 1, status: 1 })
    .sort({ createdAt: -1 });

  return memberships.map((membership) => {
    const member = toMemberResponse(
      membership as unknown as {
        _id: { toString(): string };
        tenantId: { toString(): string };
        role: string;
        status: string;
        createdAt?: Date;
        updatedAt?: Date;
        userId: null | {
          _id: { toString(): string };
          email?: string;
          fullName?: string;
          status?: string;
        };
      }
    );

    return {
      ...member,
      isOwner: ownerUserId !== null && member.user?.id === ownerUserId
    };
  });
};

export const assignTenantMember = async (input: AssignTenantMemberInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  const ownerUserId = await resolveOwnerUserId(input.tenantId);

  const normalizedEmail = input.email.trim().toLowerCase();
  const user = await UserModel.findOne({ email: normalizedEmail }).select({
    _id: 1,
    email: 1,
    fullName: 1,
    status: 1
  });

  if (!user) {
    throw new AppError('User not found.', 404, 'user.not_found');
  }

  if (ownerUserId !== null && user._id.toString() === ownerUserId) {
    throw new AppError(
      'Tenant owner membership cannot be edited.',
      403,
      'tenant.owner_membership_protected'
    );
  }

  const membership = await MembershipModel.findOneAndUpdate(
    { userId: user._id, tenantId: input.tenantId },
    {
      $set: {
        role: input.role,
        status: input.status ?? 'ACTIVE'
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).populate('userId', { _id: 1, email: 1, fullName: 1, status: 1 });

  const assigned = toMemberResponse(
    membership as unknown as {
      _id: { toString(): string };
      tenantId: { toString(): string };
      role: string;
      status: string;
      createdAt?: Date;
      updatedAt?: Date;
      userId: null | {
        _id: { toString(): string };
        email?: string;
        fullName?: string;
        status?: string;
      };
    }
  );

  return {
    ...assigned,
    isOwner: ownerUserId !== null && assigned.user?.id === ownerUserId
  };
};

export const updateTenantMember = async (
  tenantId: string,
  membershipId: string,
  updates: UpdateTenantMemberInput
) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(membershipId, 'Invalid membership id.');
  const ownerUserId = await resolveOwnerUserId(tenantId);

  const membership = await MembershipModel.findOne({ _id: membershipId, tenantId }).populate('userId', {
    _id: 1,
    email: 1,
    fullName: 1,
    status: 1
  });

  if (!membership) {
    throw new AppError('Membership not found.', 404, 'membership.not_found');
  }

  const targetUserId = membership.userId && typeof membership.userId !== 'string'
    ? membership.userId._id.toString()
    : null;

  if (ownerUserId !== null && targetUserId === ownerUserId) {
    throw new AppError(
      'Tenant owner membership cannot be edited.',
      403,
      'tenant.owner_membership_protected'
    );
  }

  if (updates.role !== undefined) {
    membership.role = updates.role;
  }

  if (updates.status !== undefined) {
    membership.status = updates.status;
  }

  await membership.save();

  const updated = toMemberResponse(
    membership as unknown as {
      _id: { toString(): string };
      tenantId: { toString(): string };
      role: string;
      status: string;
      createdAt?: Date;
      updatedAt?: Date;
      userId: null | {
        _id: { toString(): string };
        email?: string;
        fullName?: string;
        status?: string;
      };
    }
  );

  return {
    ...updated,
    isOwner: ownerUserId !== null && updated.user?.id === ownerUserId
  };
};

export const removeTenantMember = async (tenantId: string, membershipId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(membershipId, 'Invalid membership id.');
  const ownerUserId = await resolveOwnerUserId(tenantId);

  const membership = await MembershipModel.findOne({ _id: membershipId, tenantId }).select({
    _id: 1,
    userId: 1
  });
  if (!membership) {
    throw new AppError('Membership not found.', 404, 'membership.not_found');
  }

  if (ownerUserId !== null && membership.userId.toString() === ownerUserId) {
    throw new AppError(
      'Tenant owner membership cannot be removed.',
      403,
      'tenant.owner_membership_protected'
    );
  }

  await MembershipModel.deleteOne({ _id: membershipId, tenantId });
  return { membershipId };
};

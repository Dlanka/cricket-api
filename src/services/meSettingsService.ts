import bcrypt from 'bcrypt';
import { isValidObjectId } from 'mongoose';
import { MembershipModel } from '../models/membership';
import { TenantModel } from '../models/tenant';
import { UserModel } from '../models/user';
import { UserSettingsModel } from '../models/userSettings';
import { AppError } from '../utils/appError';
import { getAuthorizationContractVersion, getEffectivePermissions } from './authorizationService';

export type MeContext = {
  userId: string;
  tenantId: string;
  role: string;
};

export type MeSettingsUpdateInput = {
  profile?: {
    fullName?: string;
  };
  preferences?: {
    locale?: string;
    timezone?: string;
    dateFormat?: string;
    theme?: 'light' | 'dark' | 'system';
    notifications?: {
      email?: boolean;
      inApp?: boolean;
    };
  };
};

const ensureObjectId = (id: string, message: string) => {
  if (!isValidObjectId(id)) {
    throw new AppError(message, 400, 'validation.invalid_id');
  }
};

const ensureUserSettings = async (userId: string) => {
  let settings = await UserSettingsModel.findOne({ userId });
  if (settings) {
    return settings;
  }

  settings = await UserSettingsModel.create({ userId });
  return settings;
};

const resolveOwnerUserId = async (tenantId: string): Promise<string | null> => {
  const tenant = await TenantModel.findById(tenantId).select({ _id: 1, ownerUserId: 1 });
  if (!tenant) {
    return null;
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

export const getMeSettings = async (context: MeContext) => {
  ensureObjectId(context.userId, 'Invalid user id.');
  ensureObjectId(context.tenantId, 'Invalid tenant id.');

  const [user, settings, currentTenant, memberships, ownerUserId, permissions] = await Promise.all([
    UserModel.findById(context.userId).select({ _id: 1, email: 1, fullName: 1, status: 1, createdAt: 1, updatedAt: 1 }),
    ensureUserSettings(context.userId),
    TenantModel.findById(context.tenantId).select({ _id: 1, name: 1, status: 1 }),
    MembershipModel.find({ userId: context.userId, status: 'ACTIVE' })
      .populate('tenantId', { _id: 1, name: 1, status: 1 })
      .select({ tenantId: 1, role: 1, status: 1 }),
    resolveOwnerUserId(context.tenantId),
    getEffectivePermissions(context.tenantId, context.role)
  ]);

  if (!user) {
    throw new AppError('User not found.', 404, 'auth.user_not_found');
  }

  if (!currentTenant) {
    throw new AppError('Tenant not found.', 404, 'tenant.not_found');
  }

  return {
    profile: {
      fullName: user.fullName,
      email: user.email,
      avatarUrl: null
    },
    preferences: {
      locale: settings.preferences.locale,
      timezone: settings.preferences.timezone,
      dateFormat: settings.preferences.dateFormat,
      theme: settings.preferences.theme,
      notifications: {
        email: settings.preferences.notifications.email,
        inApp: settings.preferences.notifications.inApp
      }
    },
    account: {
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: null
    },
    tenantContext: {
      current: {
        id: currentTenant._id.toString(),
        name: currentTenant.name,
        role: context.role,
        isOwner: ownerUserId !== null && ownerUserId === context.userId
      },
      memberships: memberships
        .filter((membership) => membership.tenantId && typeof membership.tenantId !== 'string')
        .map((membership) => {
          const tenant = membership.tenantId as unknown as { _id: { toString(): string }; name: string; status: string };
          return {
            tenantId: tenant._id.toString(),
            tenantName: tenant.name,
            tenantStatus: tenant.status,
            role: membership.role,
            membershipStatus: membership.status
          };
        })
    },
    authorization: {
      permissions,
      version: getAuthorizationContractVersion()
    }
  };
};

export const updateMeSettings = async (context: MeContext, updates: MeSettingsUpdateInput) => {
  ensureObjectId(context.userId, 'Invalid user id.');

  const [user, settings] = await Promise.all([
    UserModel.findById(context.userId),
    ensureUserSettings(context.userId)
  ]);

  if (!user) {
    throw new AppError('User not found.', 404, 'auth.user_not_found');
  }

  if (updates.profile?.fullName !== undefined) {
    user.fullName = updates.profile.fullName;
    await user.save();
  }

  if (updates.preferences) {
    settings.preferences = {
      locale: updates.preferences.locale ?? settings.preferences.locale,
      timezone: updates.preferences.timezone ?? settings.preferences.timezone,
      dateFormat: updates.preferences.dateFormat ?? settings.preferences.dateFormat,
      theme: updates.preferences.theme ?? settings.preferences.theme,
      notifications: {
        email: updates.preferences.notifications?.email ?? settings.preferences.notifications.email,
        inApp: updates.preferences.notifications?.inApp ?? settings.preferences.notifications.inApp
      }
    };
    await settings.save();
  }

  return getMeSettings(context);
};

export const changeMyPassword = async (
  context: MeContext,
  input: { currentPassword: string; newPassword: string }
) => {
  ensureObjectId(context.userId, 'Invalid user id.');

  const user = await UserModel.findById(context.userId).select({ _id: 1, passwordHash: 1 });
  if (!user) {
    throw new AppError('User not found.', 404, 'auth.user_not_found');
  }

  const currentValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!currentValid) {
    throw new AppError('Current password is incorrect.', 400, 'auth.invalid_current_password');
  }

  user.passwordHash = await bcrypt.hash(input.newPassword, 12);
  await user.save();

  return { changed: true };
};

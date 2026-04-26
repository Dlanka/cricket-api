import { isValidObjectId } from 'mongoose';
import { AppSettingsModel } from '../models/appSettings';
import { TenantModel } from '../models/tenant';
import { AppError } from '../utils/appError';

export type AppSettingsUpdateInput = {
  organization?: {
    tenantName?: string;
    timezone?: string;
    locale?: string;
    dateFormat?: string;
    logoUrl?: string | null;
  };
  tournamentDefaults?: {
    defaultType?: 'LEAGUE' | 'KNOCKOUT' | 'LEAGUE_KNOCKOUT' | 'SERIES';
    defaultOversPerInnings?: number;
    defaultBallsPerOver?: number;
    defaultQualificationCount?: number;
    points?: {
      win?: number;
      tie?: number;
      noResult?: number;
      loss?: number;
    };
  };
  matchRules?: {
    allowUndo?: boolean;
    maxUndoWindowSec?: number;
    lockRosterAfterStart?: boolean;
    lockMatchConfigAfterStart?: boolean;
    requireBothRostersBeforeStart?: boolean;
  };
  permissions?: {
    ADMIN?: string[];
    SCORER?: string[];
    VIEWER?: string[];
  };
};

const ensureObjectId = (id: string, message: string) => {
  if (!isValidObjectId(id)) {
    throw new AppError(message, 400, 'validation.invalid_id');
  }
};

const getOrCreateAppSettings = async (tenantId: string) => {
  let settings = await AppSettingsModel.findOne({ tenantId });
  if (settings) {
    return settings;
  }

  const tenant = await TenantModel.findById(tenantId).select({ name: 1 });
  settings = await AppSettingsModel.create({
    tenantId,
    organization: {
      tenantName: tenant?.name ?? 'Organization'
    }
  });

  return settings;
};

export const getAppSettings = async (tenantId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  return getOrCreateAppSettings(tenantId);
};

export const updateAppSettings = async (tenantId: string, updates: AppSettingsUpdateInput) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');

  const settings = await getOrCreateAppSettings(tenantId);

  if (updates.organization) {
    settings.organization = {
      tenantName: updates.organization.tenantName ?? settings.organization.tenantName,
      timezone: updates.organization.timezone ?? settings.organization.timezone,
      locale: updates.organization.locale ?? settings.organization.locale,
      dateFormat: updates.organization.dateFormat ?? settings.organization.dateFormat,
      logoUrl:
        updates.organization.logoUrl === null
          ? undefined
          : updates.organization.logoUrl ?? settings.organization.logoUrl
    };
  }

  if (updates.tournamentDefaults) {
    settings.tournamentDefaults = {
      defaultType: updates.tournamentDefaults.defaultType ?? settings.tournamentDefaults.defaultType,
      defaultOversPerInnings:
        updates.tournamentDefaults.defaultOversPerInnings ??
        settings.tournamentDefaults.defaultOversPerInnings,
      defaultBallsPerOver:
        updates.tournamentDefaults.defaultBallsPerOver ??
        settings.tournamentDefaults.defaultBallsPerOver,
      defaultQualificationCount:
        updates.tournamentDefaults.defaultQualificationCount ??
        settings.tournamentDefaults.defaultQualificationCount,
      points: {
        win: updates.tournamentDefaults.points?.win ?? settings.tournamentDefaults.points?.win ?? 2,
        tie: updates.tournamentDefaults.points?.tie ?? settings.tournamentDefaults.points?.tie ?? 1,
        noResult:
          updates.tournamentDefaults.points?.noResult ?? settings.tournamentDefaults.points?.noResult ?? 1,
        loss: updates.tournamentDefaults.points?.loss ?? settings.tournamentDefaults.points?.loss ?? 0
      }
    };
  }

  if (updates.matchRules) {
    settings.matchRules = {
      allowUndo: updates.matchRules.allowUndo ?? settings.matchRules.allowUndo,
      maxUndoWindowSec: updates.matchRules.maxUndoWindowSec ?? settings.matchRules.maxUndoWindowSec,
      lockRosterAfterStart:
        updates.matchRules.lockRosterAfterStart ?? settings.matchRules.lockRosterAfterStart,
      lockMatchConfigAfterStart:
        updates.matchRules.lockMatchConfigAfterStart ?? settings.matchRules.lockMatchConfigAfterStart,
      requireBothRostersBeforeStart:
        updates.matchRules.requireBothRostersBeforeStart ??
        settings.matchRules.requireBothRostersBeforeStart
    };
  }

  if (updates.permissions) {
    settings.permissions = {
      ADMIN: updates.permissions.ADMIN ?? settings.permissions.ADMIN,
      SCORER: updates.permissions.SCORER ?? settings.permissions.SCORER,
      VIEWER: updates.permissions.VIEWER ?? settings.permissions.VIEWER
    };
  }

  await settings.save();
  return settings;
};

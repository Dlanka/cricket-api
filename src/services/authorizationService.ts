import { getAppSettings } from './appSettingsService';
import {
  ACTION_KEYS,
  AUTHZ_VERSION,
  DEFAULT_ROLE_PERMISSIONS,
  isAppRole,
  type ActionKey,
  type AppRole
} from '../constants/authz';
import { ENDPOINT_AUTH_MATRIX } from '../constants/authzMatrix';

const uniquePermissions = (permissions: ActionKey[]) => Array.from(new Set(permissions));

const normalizePermissions = (permissions: string[] | undefined, fallback: ActionKey[]): ActionKey[] => {
  if (permissions === undefined) {
    return fallback;
  }

  const allowed = new Set<ActionKey>(ACTION_KEYS);
  const normalized = permissions.filter((permission): permission is ActionKey =>
    allowed.has(permission as ActionKey)
  );

  return uniquePermissions(normalized);
};

const resolveRolePermissionsFromSettings = (
  role: AppRole,
  rolePermissions: { ADMIN?: string[]; SCORER?: string[]; VIEWER?: string[] } | undefined
): ActionKey[] => {
  const defaults = DEFAULT_ROLE_PERMISSIONS[role];
  if (!rolePermissions) {
    return defaults;
  }

  if (role === 'ADMIN') {
    return normalizePermissions(rolePermissions.ADMIN, defaults);
  }

  if (role === 'SCORER') {
    return normalizePermissions(rolePermissions.SCORER, defaults);
  }

  return normalizePermissions(rolePermissions.VIEWER, defaults);
};

export const getEffectivePermissions = async (tenantId: string, role: string): Promise<ActionKey[]> => {
  if (!isAppRole(role)) {
    return [];
  }

  const settings = await getAppSettings(tenantId);
  const permissions = resolveRolePermissionsFromSettings(role, settings.permissions);
  return uniquePermissions(permissions);
};

export const canPerformAction = (permissions: ReadonlyArray<ActionKey>, required: ActionKey): boolean => {
  return permissions.includes('*') || permissions.includes(required);
};

export const getActionCapabilities = (permissions: ReadonlyArray<ActionKey>) => {
  return ACTION_KEYS.reduce<Record<ActionKey, boolean>>((acc, action) => {
    acc[action] = canPerformAction(permissions, action);
    return acc;
  }, {} as Record<ActionKey, boolean>);
};

export const getAuthzMatrix = () => ENDPOINT_AUTH_MATRIX;

export const getAuthorizationContractVersion = () => AUTHZ_VERSION;

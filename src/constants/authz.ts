export const ACTION_KEYS = [
  '*',
  'tournament.manage',
  'fixture.generate',
  'roster.manage',
  'match.start',
  'score.write',
  'bowler.change'
] as const;

export type ActionKey = (typeof ACTION_KEYS)[number];

export const APP_ROLES = ['ADMIN', 'SCORER', 'VIEWER'] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const DEFAULT_ROLE_PERMISSIONS: Record<AppRole, ActionKey[]> = {
  ADMIN: ['*'],
  SCORER: ['roster.manage', 'match.start', 'score.write', 'bowler.change'],
  VIEWER: []
};

export const AUTHZ_VERSION = 1;
export const FUTURE_ADMIN_OPS_DEFAULT_ACTION: ActionKey = 'tournament.manage';

export const isAppRole = (value: string): value is AppRole => {
  return APP_ROLES.includes(value as AppRole);
};

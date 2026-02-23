import type { ActionKey } from './authz';

export type EndpointAuthMatrixRow = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  action: ActionKey | null;
  auth: 'app';
  area: string;
  ownerOverride?: boolean;
};

export const ENDPOINT_AUTH_MATRIX: EndpointAuthMatrixRow[] = [
  { method: 'GET', path: '/me', action: null, auth: 'app', area: 'auth' },
  { method: 'GET', path: '/me/settings', action: null, auth: 'app', area: 'auth' },
  { method: 'PATCH', path: '/me/settings', action: null, auth: 'app', area: 'auth' },
  { method: 'PATCH', path: '/me/password', action: null, auth: 'app', area: 'auth' },
  { method: 'POST', path: '/auth/logout', action: null, auth: 'app', area: 'auth' },
  { method: 'GET', path: '/me/permissions', action: null, auth: 'app', area: 'authz' },
  { method: 'GET', path: '/authz/capabilities', action: null, auth: 'app', area: 'authz' },
  { method: 'GET', path: '/authz/matrix', action: null, auth: 'app', area: 'authz' },
  { method: 'GET', path: '/tenant/current', action: null, auth: 'app', area: 'tenant' },
  {
    method: 'GET',
    path: '/tenant/members',
    action: 'tournament.manage',
    auth: 'app',
    area: 'admin'
  },
  {
    method: 'POST',
    path: '/tenant/members',
    action: 'tournament.manage',
    auth: 'app',
    area: 'admin'
  },
  {
    method: 'PATCH',
    path: '/tenant/members/:membershipId',
    action: 'tournament.manage',
    auth: 'app',
    area: 'admin'
  },
  {
    method: 'DELETE',
    path: '/tenant/members/:membershipId',
    action: 'tournament.manage',
    auth: 'app',
    area: 'admin'
  },
  { method: 'GET', path: '/settings/app', action: null, auth: 'app', area: 'settings' },
  {
    method: 'PATCH',
    path: '/settings/app',
    action: 'tournament.manage',
    auth: 'app',
    area: 'settings',
    ownerOverride: true
  },
  {
    method: 'POST',
    path: '/tournaments',
    action: 'tournament.manage',
    auth: 'app',
    area: 'tournaments'
  },
  { method: 'GET', path: '/tournaments', action: null, auth: 'app', area: 'tournaments' },
  { method: 'GET', path: '/tournaments/:id', action: null, auth: 'app', area: 'tournaments' },
  {
    method: 'PATCH',
    path: '/tournaments/:id',
    action: 'tournament.manage',
    auth: 'app',
    area: 'tournaments'
  },
  {
    method: 'DELETE',
    path: '/tournaments/:id',
    action: 'tournament.manage',
    auth: 'app',
    area: 'tournaments'
  },
  {
    method: 'POST',
    path: '/tournaments/:id/recompute-standings',
    action: 'tournament.manage',
    auth: 'app',
    area: 'standings'
  },
  {
    method: 'POST',
    path: '/tournaments/:id/generate-knockout',
    action: 'fixture.generate',
    auth: 'app',
    area: 'fixtures'
  },
  {
    method: 'GET',
    path: '/tournaments/:id/standings',
    action: null,
    auth: 'app',
    area: 'standings'
  },
  { method: 'GET', path: '/tournaments/:id/stats', action: null, auth: 'app', area: 'stats' },
  {
    method: 'POST',
    path: '/tournaments/:tournamentId/teams',
    action: 'tournament.manage',
    auth: 'app',
    area: 'teams'
  },
  {
    method: 'PATCH',
    path: '/teams/:id',
    action: 'tournament.manage',
    auth: 'app',
    area: 'teams'
  },
  {
    method: 'DELETE',
    path: '/teams/:id',
    action: 'tournament.manage',
    auth: 'app',
    area: 'teams'
  },
  {
    method: 'GET',
    path: '/tournaments/:tournamentId/teams',
    action: null,
    auth: 'app',
    area: 'teams'
  },
  { method: 'GET', path: '/teams/:id', action: null, auth: 'app', area: 'teams' },
  {
    method: 'POST',
    path: '/teams/:id/access-links',
    action: 'tournament.manage',
    auth: 'app',
    area: 'team-access'
  },
  {
    method: 'GET',
    path: '/teams/:id/access-links',
    action: 'tournament.manage',
    auth: 'app',
    area: 'team-access'
  },
  {
    method: 'POST',
    path: '/teams/:id/access-links/whatsapp-share',
    action: 'tournament.manage',
    auth: 'app',
    area: 'team-access'
  },
  {
    method: 'GET',
    path: '/teams/:id/access-links/current-share',
    action: 'tournament.manage',
    auth: 'app',
    area: 'team-access'
  },
  {
    method: 'DELETE',
    path: '/teams/:id/access-links/:linkId',
    action: 'tournament.manage',
    auth: 'app',
    area: 'team-access'
  },
  { method: 'GET', path: '/team-access/:token/context', action: null, auth: 'app', area: 'team-access' },
  {
    method: 'POST',
    path: '/team-access/:token/players',
    action: null,
    auth: 'app',
    area: 'team-access'
  },
  {
    method: 'PATCH',
    path: '/team-access/:token/players/:playerId',
    action: null,
    auth: 'app',
    area: 'team-access'
  },
  {
    method: 'POST',
    path: '/teams/:teamId/players',
    action: 'tournament.manage',
    auth: 'app',
    area: 'players'
  },
  {
    method: 'PATCH',
    path: '/players/:id',
    action: 'tournament.manage',
    auth: 'app',
    area: 'players'
  },
  {
    method: 'DELETE',
    path: '/players/:id',
    action: 'tournament.manage',
    auth: 'app',
    area: 'players'
  },
  { method: 'GET', path: '/teams/:teamId/players', action: null, auth: 'app', area: 'players' },
  { method: 'GET', path: '/players/:id', action: null, auth: 'app', area: 'players' },
  {
    method: 'POST',
    path: '/matches/:matchId/roster',
    action: 'roster.manage',
    auth: 'app',
    area: 'roster'
  },
  { method: 'GET', path: '/matches/:matchId/roster', action: null, auth: 'app', area: 'roster' },
  {
    method: 'POST',
    path: '/tournaments/:tournamentId/generate-fixtures',
    action: 'fixture.generate',
    auth: 'app',
    area: 'fixtures'
  },
  {
    method: 'PATCH',
    path: '/matches/:matchId/config',
    action: 'tournament.manage',
    auth: 'app',
    area: 'match-center'
  },
  {
    method: 'POST',
    path: '/matches/:matchId/start',
    action: 'match.start',
    auth: 'app',
    area: 'match-center'
  },
  {
    method: 'POST',
    path: '/matches/:matchId/start-second-innings',
    action: 'match.start',
    auth: 'app',
    area: 'match-center'
  },
  {
    method: 'PATCH',
    path: '/matches/:matchId/current-bowler',
    action: 'bowler.change',
    auth: 'app',
    area: 'match-center'
  },
  {
    method: 'POST',
    path: '/matches/:matchId/score-events',
    action: 'score.write',
    auth: 'app',
    area: 'scoring'
  },
  {
    method: 'GET',
    path: '/matches/:matchId/available-next-batters',
    action: null,
    auth: 'app',
    area: 'match-center'
  },
  {
    method: 'GET',
    path: '/tournaments/:tournamentId/matches',
    action: null,
    auth: 'app',
    area: 'fixtures'
  },
  {
    method: 'GET',
    path: '/tournaments/:tournamentId/fixtures-bracket',
    action: null,
    auth: 'app',
    area: 'fixtures'
  },
  {
    method: 'GET',
    path: '/tournaments/:tournamentId/fixtures-view',
    action: null,
    auth: 'app',
    area: 'fixtures'
  },
  { method: 'GET', path: '/matches/:matchId', action: null, auth: 'app', area: 'match-center' },
  {
    method: 'GET',
    path: '/matches/:matchId/score',
    action: null,
    auth: 'app',
    area: 'scoring'
  },
  {
    method: 'GET',
    path: '/matches/:matchId/summary',
    action: null,
    auth: 'app',
    area: 'scoring'
  },
  { method: 'GET', path: '/innings/:inningsId/batters', action: null, auth: 'app', area: 'scoring' },
  { method: 'GET', path: '/innings/:inningsId/bowlers', action: null, auth: 'app', area: 'scoring' },
  { method: 'GET', path: '/innings/:inningsId/overs', action: null, auth: 'app', area: 'scoring' },
  { method: 'GET', path: '/innings/:inningsId/events', action: null, auth: 'app', area: 'scoring' }
];

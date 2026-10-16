import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import { requireAction } from '../middleware/requireAction';
import {
  assignTeamsToGroupsHandler,
  autoAssignTeamsHandler,
  createTeamHandler,
  deleteTeamHandler,
  getTeamHandler,
  listTeamsHandler,
  reorderTeamsHandler,
  updateTeamHandler
} from '../controllers/teamController';

export const teamRoutes = Router();

teamRoutes.post(
  '/tournaments/:tournamentId/teams',
  requireAuthApp,
  requireAction('tournament.manage'),
  createTeamHandler
);
teamRoutes.get('/tournaments/:tournamentId/teams', requireAuthApp, listTeamsHandler);
teamRoutes.post(
  '/tournaments/:tournamentId/teams/auto-assign-groups',
  requireAuthApp,
  requireAction('tournament.manage'),
  autoAssignTeamsHandler
);
teamRoutes.post(
  '/tournaments/:tournamentId/teams/assign-groups',
  requireAuthApp,
  requireAction('tournament.manage'),
  assignTeamsToGroupsHandler
);

teamRoutes.patch(
  '/tournaments/:tournamentId/teams/order',
  requireAuthApp,
  requireAction('tournament.manage'),
  reorderTeamsHandler
);
teamRoutes.get('/teams/:id', requireAuthApp, getTeamHandler);
teamRoutes.patch('/teams/:id', requireAuthApp, requireAction('tournament.manage'), updateTeamHandler);
teamRoutes.delete('/teams/:id', requireAuthApp, requireAction('tournament.manage'), deleteTeamHandler);

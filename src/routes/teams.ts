import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import { requireAction } from '../middleware/requireAction';
import {
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
teamRoutes.patch(
  '/tournaments/:tournamentId/teams/order',
  requireAuthApp,
  requireAction('tournament.manage'),
  reorderTeamsHandler
);
teamRoutes.get('/teams/:id', requireAuthApp, getTeamHandler);
teamRoutes.patch('/teams/:id', requireAuthApp, requireAction('tournament.manage'), updateTeamHandler);
teamRoutes.delete('/teams/:id', requireAuthApp, requireAction('tournament.manage'), deleteTeamHandler);

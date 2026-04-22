import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import { requireAction } from '../middleware/requireAction';
import {
  createTournamentHandler,
  deleteTournamentHandler,
  duplicateTournamentHandler,
  generateKnockoutFromLeagueHandler,
  getTournamentHandler,
  getTournamentPlayerOfSeriesHandler,
  getTournamentStatsHandler,
  getTournamentStandingsHandler,
  listTournamentsHandler,
  recomputeTournamentStandingsHandler,
  updateTournamentHandler
} from '../controllers/tournamentController';

export const tournamentRoutes = Router();

tournamentRoutes.post(
  '/tournaments',
  requireAuthApp,
  requireAction('tournament.manage'),
  createTournamentHandler
);

tournamentRoutes.get('/tournaments', requireAuthApp, listTournamentsHandler);

tournamentRoutes.get('/tournaments/:id', requireAuthApp, getTournamentHandler);
tournamentRoutes.get('/tournaments/:id/standings', requireAuthApp, getTournamentStandingsHandler);
tournamentRoutes.get('/tournaments/:id/stats', requireAuthApp, getTournamentStatsHandler);
tournamentRoutes.get(
  '/tournaments/:id/awards/player-of-series',
  requireAuthApp,
  getTournamentPlayerOfSeriesHandler
);

tournamentRoutes.patch(
  '/tournaments/:id',
  requireAuthApp,
  requireAction('tournament.manage'),
  updateTournamentHandler
);

tournamentRoutes.delete(
  '/tournaments/:id',
  requireAuthApp,
  requireAction('tournament.manage'),
  deleteTournamentHandler
);

tournamentRoutes.post(
  '/tournaments/:id/duplicate',
  requireAuthApp,
  requireAction('tournament.manage'),
  duplicateTournamentHandler
);

tournamentRoutes.post(
  '/tournaments/:id/recompute-standings',
  requireAuthApp,
  requireAction('tournament.manage'),
  recomputeTournamentStandingsHandler
);

tournamentRoutes.post(
  '/tournaments/:id/generate-knockout',
  requireAuthApp,
  requireAction('fixture.generate'),
  generateKnockoutFromLeagueHandler
);

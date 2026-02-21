import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import { requireAction } from '../middleware/requireAction';
import {
  changeCurrentBowlerHandler,
  getAvailableNextBattersHandler,
  getTournamentFixturesBracketHandler,
  getTournamentFixturesViewHandler,
  generateFixturesHandler,
  getMatchHandler,
  getMatchScoreHandler,
  listMatchesHandler,
  startMatchHandler,
  startSecondInningsHandler,
  updateMatchConfigHandler
} from '../controllers/matchController';
import { getMatchSummaryHandler } from '../controllers/getMatchSummary.controller';
import { scoreMatchEventHandler } from '../controllers/scoreEventController';

export const matchRoutes = Router();

matchRoutes.get('/tournaments/:tournamentId/matches', requireAuthApp, listMatchesHandler);
matchRoutes.get(
  '/tournaments/:tournamentId/fixtures-bracket',
  requireAuthApp,
  getTournamentFixturesBracketHandler
);
matchRoutes.get(
  '/tournaments/:tournamentId/fixtures-view',
  requireAuthApp,
  getTournamentFixturesViewHandler
);

matchRoutes.post(
  '/tournaments/:tournamentId/generate-fixtures',
  requireAuthApp,
  requireAction('fixture.generate'),
  generateFixturesHandler
);

matchRoutes.get('/matches/:matchId', requireAuthApp, getMatchHandler);
matchRoutes.patch(
  '/matches/:matchId/config',
  requireAuthApp,
  requireAction('tournament.manage'),
  updateMatchConfigHandler
);

matchRoutes.post(
  '/matches/:matchId/start',
  requireAuthApp,
  requireAction('match.start'),
  startMatchHandler
);

matchRoutes.post(
  '/matches/:matchId/start-second-innings',
  requireAuthApp,
  requireAction('match.start'),
  startSecondInningsHandler
);

matchRoutes.get('/matches/:matchId/score', requireAuthApp, getMatchScoreHandler);
matchRoutes.get('/matches/:matchId/summary', requireAuthApp, getMatchSummaryHandler);

matchRoutes.patch(
  '/matches/:matchId/current-bowler',
  requireAuthApp,
  requireAction('bowler.change'),
  changeCurrentBowlerHandler
);

matchRoutes.get('/matches/:matchId/available-next-batters', requireAuthApp, getAvailableNextBattersHandler);

matchRoutes.post(
  '/matches/:matchId/score-events',
  requireAuthApp,
  requireAction('score.write'),
  scoreMatchEventHandler
);

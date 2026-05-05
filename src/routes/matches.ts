import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import { requireAction } from '../middleware/requireAction';
import {
  changeCurrentBowlerHandler,
  changeOnFieldBattersHandler,
  getAvailableNextBattersHandler,
  getTournamentFixturesBracketHandler,
  getTournamentFixturesViewHandler,
  generateFixturesHandler,
  getMatchHandler,
  getMatchScoreHandler,
  listMatchesHandler,
  resolveMatchTieHandler,
  setMatchTossHandler,
  pauseMatchTimerHandler,
  resumeMatchTimerHandler,
  startMatchTimerHandler,
  startSuperOverHandler,
  startMatchHandler,
  startSecondInningsHandler,
  updateMatchConfigHandler,
  updateMatchTimeConfigHandler
} from '../controllers/matchController';
import {
  getMatchPlayerOfMatchHandler,
  getMatchSummaryHandler
} from '../controllers/getMatchSummary.controller';
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
  '/matches/:matchId/toss',
  requireAuthApp,
  requireAction('match.start'),
  setMatchTossHandler
);
matchRoutes.patch(
  '/matches/:matchId/config',
  requireAuthApp,
  requireAction('tournament.manage'),
  updateMatchConfigHandler
);
matchRoutes.patch(
  '/matches/:matchId/time-config',
  requireAuthApp,
  requireAction('tournament.manage'),
  updateMatchTimeConfigHandler
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

matchRoutes.post(
  '/matches/:matchId/start-super-over',
  requireAuthApp,
  requireAction('match.start'),
  startSuperOverHandler
);

matchRoutes.get('/matches/:matchId/score', requireAuthApp, getMatchScoreHandler);
matchRoutes.get('/matches/:matchId/summary', requireAuthApp, getMatchSummaryHandler);
matchRoutes.get('/matches/:matchId/awards/player-of-match', requireAuthApp, getMatchPlayerOfMatchHandler);
matchRoutes.post('/matches/:matchId/timer/start', requireAuthApp, requireAction('match.start'), startMatchTimerHandler);
matchRoutes.post('/matches/:matchId/timer/pause', requireAuthApp, requireAction('match.start'), pauseMatchTimerHandler);
matchRoutes.post('/matches/:matchId/timer/resume', requireAuthApp, requireAction('match.start'), resumeMatchTimerHandler);

matchRoutes.patch(
  '/matches/:matchId/current-bowler',
  requireAuthApp,
  requireAction('bowler.change'),
  changeCurrentBowlerHandler
);

matchRoutes.patch(
  '/matches/:matchId/current-batters',
  requireAuthApp,
  requireAction('score.write'),
  changeOnFieldBattersHandler
);

matchRoutes.patch(
  '/matches/:matchId/tie-breaker',
  requireAuthApp,
  requireAction('match.start'),
  resolveMatchTieHandler
);

matchRoutes.get('/matches/:matchId/available-next-batters', requireAuthApp, getAvailableNextBattersHandler);

matchRoutes.post(
  '/matches/:matchId/score-events',
  requireAuthApp,
  requireAction('score.write'),
  scoreMatchEventHandler
);

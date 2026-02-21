import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import { requireAction } from '../middleware/requireAction';
import { getRosterHandler, replaceRosterHandler } from '../controllers/matchRosterController';

export const matchRosterRoutes = Router();

matchRosterRoutes.post(
  '/matches/:matchId/roster',
  requireAuthApp,
  requireAction('roster.manage'),
  replaceRosterHandler
);

matchRosterRoutes.get('/matches/:matchId/roster', requireAuthApp, getRosterHandler);

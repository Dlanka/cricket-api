import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import { requireAction } from '../middleware/requireAction';
import {
  createPlayerHandler,
  deletePlayerHandler,
  getPlayerHandler,
  listPlayersHandler,
  updatePlayerHandler
} from '../controllers/playerController';

export const playerRoutes = Router();

playerRoutes.post(
  '/teams/:teamId/players',
  requireAuthApp,
  requireAction('tournament.manage'),
  createPlayerHandler
);
playerRoutes.get('/teams/:teamId/players', requireAuthApp, listPlayersHandler);
playerRoutes.get('/players/:id', requireAuthApp, getPlayerHandler);
playerRoutes.patch('/players/:id', requireAuthApp, requireAction('tournament.manage'), updatePlayerHandler);
playerRoutes.delete('/players/:id', requireAuthApp, requireAction('tournament.manage'), deletePlayerHandler);

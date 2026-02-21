import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import {
  getInningsBattersHandler,
  getInningsBowlersHandler,
  getInningsEventsHandler,
  getInningsOversHandler
} from '../controllers/inningsReadController';

export const inningsReadRoutes = Router();

inningsReadRoutes.get('/innings/:inningsId/batters', requireAuthApp, getInningsBattersHandler);
inningsReadRoutes.get('/innings/:inningsId/bowlers', requireAuthApp, getInningsBowlersHandler);
inningsReadRoutes.get('/innings/:inningsId/overs', requireAuthApp, getInningsOversHandler);
inningsReadRoutes.get('/innings/:inningsId/events', requireAuthApp, getInningsEventsHandler);

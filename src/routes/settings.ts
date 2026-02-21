import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import { requireActionOrOwner } from '../middleware/requireActionOrOwner';
import { getAppSettingsHandler, updateAppSettingsHandler } from '../controllers/appSettingsController';

export const settingsRoutes = Router();

settingsRoutes.get('/settings/app', requireAuthApp, getAppSettingsHandler);
settingsRoutes.patch(
  '/settings/app',
  requireAuthApp,
  requireActionOrOwner('tournament.manage'),
  updateAppSettingsHandler
);

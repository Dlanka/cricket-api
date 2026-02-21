import { Router } from 'express';
import { login, selectTenant, me, logout, signup } from '../controllers/authController';
import { getMyPermissionsHandler } from '../controllers/authorizationController';
import { requireAuthApp } from '../middleware/requireAuthApp';
import {
  changeMyPasswordHandler,
  getMeSettingsHandler,
  updateMeSettingsHandler
} from '../controllers/meSettingsController';

export const authRoutes = Router();

authRoutes.post('/auth/signup', signup);
authRoutes.post('/auth/login', login);
authRoutes.post('/auth/select-tenant', selectTenant);
authRoutes.get('/me', requireAuthApp, me);
authRoutes.get('/me/permissions', requireAuthApp, getMyPermissionsHandler);
authRoutes.get('/me/settings', requireAuthApp, getMeSettingsHandler);
authRoutes.patch('/me/settings', requireAuthApp, updateMeSettingsHandler);
authRoutes.patch('/me/password', requireAuthApp, changeMyPasswordHandler);
authRoutes.post('/auth/logout', requireAuthApp, logout);

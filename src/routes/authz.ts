import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import { getAuthzMatrixHandler, getCapabilitiesHandler } from '../controllers/authorizationController';

export const authzRoutes = Router();

authzRoutes.get('/authz/capabilities', requireAuthApp, getCapabilitiesHandler);
authzRoutes.get('/authz/matrix', requireAuthApp, getAuthzMatrixHandler);

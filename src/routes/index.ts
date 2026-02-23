import { Router } from 'express';
import { ok } from '../utils/apiResponse';
import { requireTenant } from '../middleware/authTenant';
import { authRoutes } from './auth';
import { tenantRoutes } from './tenant';
import { tournamentRoutes } from './tournaments';
import { teamRoutes } from './teams';
import { playerRoutes } from './players';
import { matchRoutes } from './matches';
import { matchRosterRoutes } from './matchRoster';
import { inningsReadRoutes } from './inningsRead';
import { settingsRoutes } from './settings';
import { teamAccessRoutes } from './teamAccess';
import { authzRoutes } from './authz';

export const routes = Router();

routes.get('/health', (_req, res) => {
  res.status(200).json(ok());
});

routes.use(authRoutes);
routes.use(tenantRoutes);
routes.use(tournamentRoutes);
routes.use(teamRoutes);
routes.use(playerRoutes);
routes.use(matchRoutes);
routes.use(matchRosterRoutes);
routes.use(inningsReadRoutes);
routes.use(settingsRoutes);
routes.use(teamAccessRoutes);
routes.use(authzRoutes);

routes.get('/api/v1/tenants/me', requireTenant, (req, res) => {
  res.status(200).json(ok({ tenantId: req.tenantId }));
});

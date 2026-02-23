import { Router } from 'express';
import { requireAuthApp } from '../middleware/requireAuthApp';
import { requireAction } from '../middleware/requireAction';
import {
  createTeamAccessLinkHandler,
  createTeamAccessWhatsappShareHandler,
  createTeamPlayerViaAccessHandler,
  getCurrentTeamAccessShareHandler,
  getTeamAccessContextHandler,
  listTeamAccessLinksHandler,
  revokeTeamAccessLinkHandler,
  updateTeamPlayerViaAccessHandler
} from '../controllers/teamAccessController';

export const teamAccessRoutes = Router();

teamAccessRoutes.post(
  '/teams/:id/access-links',
  requireAuthApp,
  requireAction('tournament.manage'),
  createTeamAccessLinkHandler
);
teamAccessRoutes.get(
  '/teams/:id/access-links',
  requireAuthApp,
  requireAction('tournament.manage'),
  listTeamAccessLinksHandler
);
teamAccessRoutes.post(
  '/teams/:id/access-links/whatsapp-share',
  requireAuthApp,
  requireAction('tournament.manage'),
  createTeamAccessWhatsappShareHandler
);
teamAccessRoutes.get(
  '/teams/:id/access-links/current-share',
  requireAuthApp,
  requireAction('tournament.manage'),
  getCurrentTeamAccessShareHandler
);
teamAccessRoutes.delete(
  '/teams/:id/access-links/:linkId',
  requireAuthApp,
  requireAction('tournament.manage'),
  revokeTeamAccessLinkHandler
);

teamAccessRoutes.get('/team-access/:token/context', getTeamAccessContextHandler);
teamAccessRoutes.post('/team-access/:token/players', createTeamPlayerViaAccessHandler);
teamAccessRoutes.patch('/team-access/:token/players/:playerId', updateTeamPlayerViaAccessHandler);

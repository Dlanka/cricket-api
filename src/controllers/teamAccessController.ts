import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { BATTING_STYLES, BOWLING_STYLES } from '../constants/playerStyles';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import {
  createPlayerViaAccessLink,
  createTeamAccessLink,
  createTeamAccessWhatsappShare,
  getCurrentTeamAccessShare,
  getTeamAccessContext,
  listTeamAccessLinks,
  revokeTeamAccessLink,
  updatePlayerViaAccessLink
} from '../services/teamAccessService';

const teamIdSchema = z.object({ id: z.string().min(1) });
const linkIdSchema = z.object({ id: z.string().min(1), linkId: z.string().min(1) });
const tokenSchema = z.object({ token: z.string().min(1) });
const tokenPlayerSchema = z.object({ token: z.string().min(1), playerId: z.string().min(1) });

const createLinkSchema = z.object({
  expiresInHours: z.coerce.number().int().min(1).max(24 * 365).optional()
});
const createWhatsappShareSchema = z.object({
  expiresInHours: z.coerce.number().int().min(1).max(24 * 365).optional(),
  phoneNumber: z.string().trim().min(6).max(32).optional()
});

const createPlayerSchema = z.object({
  fullName: z.string().trim().min(1),
  jerseyNumber: z.coerce.number().int().min(0).optional(),
  battingStyle: z.enum(BATTING_STYLES).optional(),
  bowlingStyle: z.enum(BOWLING_STYLES).optional(),
  isWicketKeeper: z.coerce.boolean().optional()
});

const updatePlayerSchema = z
  .object({
    fullName: z.string().trim().min(1).optional(),
    jerseyNumber: z.coerce.number().int().min(0).optional(),
    battingStyle: z.enum(BATTING_STYLES).optional(),
    bowlingStyle: z.enum(BOWLING_STYLES).optional(),
    isWicketKeeper: z.coerce.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.'
  });

const getTenantId = (req: Request) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
  }
  return tenantId;
};

export const createTeamAccessLinkHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = teamIdSchema.parse(req.params);
    const body = createLinkSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const result = await createTeamAccessLink({
      tenantId,
      teamId: id,
      createdByUserId: req.auth?.userId,
      expiresInHours: body.expiresInHours
    });
    return res.status(201).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const createTeamAccessWhatsappShareHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = teamIdSchema.parse(req.params);
    const body = createWhatsappShareSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const result = await createTeamAccessWhatsappShare({
      tenantId,
      teamId: id,
      createdByUserId: req.auth?.userId,
      expiresInHours: body.expiresInHours,
      phoneNumber: body.phoneNumber
    });
    return res.status(201).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const listTeamAccessLinksHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = teamIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await listTeamAccessLinks(tenantId, id);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getCurrentTeamAccessShareHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = teamIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await getCurrentTeamAccessShare(tenantId, id);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const revokeTeamAccessLinkHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id, linkId } = linkIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await revokeTeamAccessLink(tenantId, id, linkId);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getTeamAccessContextHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { token } = tokenSchema.parse(req.params);
    const result = await getTeamAccessContext(token);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const createTeamPlayerViaAccessHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { token } = tokenSchema.parse(req.params);
    const payload = createPlayerSchema.parse(req.body);
    const player = await createPlayerViaAccessLink(token, payload);
    return res.status(201).json(ok(player));
  } catch (error) {
    return next(error);
  }
};

export const updateTeamPlayerViaAccessHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { token, playerId } = tokenPlayerSchema.parse(req.params);
    const payload = updatePlayerSchema.parse(req.body);
    const player = await updatePlayerViaAccessLink(token, playerId, payload);
    return res.status(200).json(ok(player));
  } catch (error) {
    return next(error);
  }
};

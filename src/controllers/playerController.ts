import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { BATTING_STYLES, BOWLING_STYLES } from '../constants/playerStyles';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import {
  createPlayer,
  deletePlayer,
  getPlayerById,
  listPlayersByTeam,
  updatePlayer
} from '../services/playerService';

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

const idSchema = z.object({
  id: z.string().min(1)
});

const teamIdSchema = z.object({
  teamId: z.string().min(1)
});

const getTenantId = (req: Request) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
  }
  return tenantId;
};

export const createPlayerHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { teamId } = teamIdSchema.parse(req.params);
    const input = createPlayerSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const player = await createPlayer({ tenantId, teamId, ...input });
    return res.status(201).json(ok(player));
  } catch (error) {
    return next(error);
  }
};

export const listPlayersHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { teamId } = teamIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const players = await listPlayersByTeam(tenantId, teamId);
    return res.status(200).json(ok(players));
  } catch (error) {
    return next(error);
  }
};

export const getPlayerHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const player = await getPlayerById(tenantId, id);
    return res.status(200).json(ok(player));
  } catch (error) {
    return next(error);
  }
};

export const updatePlayerHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idSchema.parse(req.params);
    const updates = updatePlayerSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const player = await updatePlayer(tenantId, id, updates);
    return res.status(200).json(ok(player));
  } catch (error) {
    return next(error);
  }
};

export const deletePlayerHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await deletePlayer(tenantId, id);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};


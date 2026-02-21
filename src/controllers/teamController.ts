import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import {
  createTeam,
  deleteTeam,
  getTeamById,
  listTeamsByTournament,
  updateTeam
} from '../services/teamService';

const createTeamSchema = z.object({
  name: z.string().trim().min(1),
  shortName: z.string().trim().min(1).optional()
});

const updateTeamSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    shortName: z.string().trim().min(1).optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.'
  });

const idSchema = z.object({
  id: z.string().min(1)
});

const tournamentIdSchema = z.object({
  tournamentId: z.string().min(1)
});

const getTenantId = (req: Request) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
  }
  return tenantId;
};

export const createTeamHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tournamentId } = tournamentIdSchema.parse(req.params);
    const input = createTeamSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const team = await createTeam({ tenantId, tournamentId, ...input });
    return res.status(201).json(ok(team));
  } catch (error) {
    return next(error);
  }
};

export const listTeamsHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tournamentId } = tournamentIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const teams = await listTeamsByTournament(tenantId, tournamentId);
    return res.status(200).json(ok(teams));
  } catch (error) {
    return next(error);
  }
};

export const getTeamHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const team = await getTeamById(tenantId, id);
    return res.status(200).json(ok(team));
  } catch (error) {
    return next(error);
  }
};

export const updateTeamHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idSchema.parse(req.params);
    const updates = updateTeamSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const team = await updateTeam(tenantId, id, updates);
    return res.status(200).json(ok(team));
  } catch (error) {
    return next(error);
  }
};

export const deleteTeamHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await deleteTeam(tenantId, id);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

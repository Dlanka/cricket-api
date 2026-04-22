import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import {
  createTournament,
  deleteTournament,
  duplicateTournament,
  generateKnockoutFromLeague,
  getTournamentById,
  getTournamentPlayerOfSeries,
  getTournamentStats,
  getTournamentStandings,
  listTournaments,
  recomputeTournamentStandings,
  updateTournament
} from '../services/tournamentService';

const tournamentTypeSchema = z.enum(['LEAGUE', 'KNOCKOUT', 'LEAGUE_KNOCKOUT']);
const tournamentStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'COMPLETED']);
const stageStatusSchema = z.enum(['PENDING', 'ACTIVE', 'COMPLETED']);
const rulesSchema = z
  .object({
    points: z
      .object({
        win: z.coerce.number().min(0).optional(),
        tie: z.coerce.number().min(0).optional(),
        noResult: z.coerce.number().min(0).optional(),
        loss: z.coerce.number().min(0).optional()
      })
      .optional(),
    qualificationCount: z.coerce.number().int().min(2).optional(),
    seeding: z.enum(['STANDARD']).optional()
  })
  .optional();
const tournamentStageSchema = z
  .object({
    league: stageStatusSchema.optional(),
    knockout: stageStatusSchema.optional()
  })
  .optional();

const createTournamentSchema = z.object({
  name: z.string().trim().min(1),
  location: z.string().trim().min(1).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  type: tournamentTypeSchema,
  oversPerInnings: z.coerce.number().int().min(1),
  ballsPerOver: z.coerce.number().int().min(1).optional(),
  status: tournamentStatusSchema.optional(),
  rules: rulesSchema,
  stageStatus: tournamentStageSchema
});

const updateTournamentSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).nullable().optional(),
    startDate: z.coerce.date().nullable().optional(),
    endDate: z.coerce.date().nullable().optional(),
    type: tournamentTypeSchema.optional(),
    oversPerInnings: z.coerce.number().int().min(1).optional(),
    ballsPerOver: z.coerce.number().int().min(1).optional(),
    status: tournamentStatusSchema.optional(),
    rules: rulesSchema,
    stageStatus: tournamentStageSchema
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.'
  });

const idSchema = z.object({
  id: z.string().min(1)
});
const duplicateTournamentSchema = z.object({
  name: z.string().trim().min(1).optional()
});

const getTenantId = (req: Request) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
  }
  return tenantId;
};

export const createTournamentHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createTournamentSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const tournament = await createTournament({ tenantId, ...input });
    return res.status(201).json(ok(tournament));
  } catch (error) {
    return next(error);
  }
};

export const listTournamentsHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const tournaments = await listTournaments(tenantId);
    return res.status(200).json(ok(tournaments));
  } catch (error) {
    return next(error);
  }
};

export const getTournamentHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const tournament = await getTournamentById(tenantId, id);
    return res.status(200).json(ok(tournament));
  } catch (error) {
    return next(error);
  }
};

export const updateTournamentHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idSchema.parse(req.params);
    const updates = updateTournamentSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const tournament = await updateTournament(tenantId, id, updates);
    return res.status(200).json(ok(tournament));
  } catch (error) {
    return next(error);
  }
};

export const deleteTournamentHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await deleteTournament(tenantId, id);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const duplicateTournamentHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = idSchema.parse(req.params);
    const { name } = duplicateTournamentSchema.parse(req.body ?? {});
    const tenantId = getTenantId(req);
    const result = await duplicateTournament({ tenantId, id, name });
    return res.status(201).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getTournamentStandingsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = idSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await getTournamentStandings(tenantId, id);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getTournamentStatsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = idSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await getTournamentStats(tenantId, id);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getTournamentPlayerOfSeriesHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = idSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await getTournamentPlayerOfSeries(tenantId, id);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const generateKnockoutFromLeagueHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = idSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await generateKnockoutFromLeague(tenantId, id);
    return res.status(201).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const recomputeTournamentStandingsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = idSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await recomputeTournamentStandings(tenantId, id);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

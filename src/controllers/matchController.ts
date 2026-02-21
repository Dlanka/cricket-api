import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/appError';
import {
  changeCurrentBowler,
  getAvailableNextBatters,
  generateFixtures,
  getMatchById,
  getMatchScore,
  getTournamentFixturesBracket,
  getTournamentFixturesView,
  listMatchesByTournament,
  startMatch,
  startSecondInnings,
  updateMatchConfig
} from '../services/matchService';

const tournamentIdSchema = z.object({
  tournamentId: z.string().min(1)
});

const matchIdSchema = z.object({
  matchId: z.string().min(1)
});

const startMatchSchema = z.object({
  battingTeamId: z.string().min(1),
  bowlingTeamId: z.string().min(1),
  strikerId: z.string().min(1),
  nonStrikerId: z.string().min(1),
  bowlerId: z.string().min(1)
});

const changeBowlerSchema = z.object({
  bowlerId: z.string().min(1)
});

const startSecondInningsSchema = z.object({
  strikerId: z.string().min(1),
  nonStrikerId: z.string().min(1),
  bowlerId: z.string().min(1)
});

const updateMatchConfigSchema = z
  .object({
    oversPerInnings: z.coerce.number().int().min(1).optional(),
    ballsPerOver: z.coerce.number().int().min(1).optional()
  })
  .refine((data) => data.oversPerInnings !== undefined || data.ballsPerOver !== undefined, {
    message: 'At least one field must be provided.'
  });

const getTenantId = (req: Request) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context missing.', 403, 'auth.missing_tenant');
  }
  return tenantId;
};

export const listMatchesHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tournamentId } = tournamentIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const matches = await listMatchesByTournament(tenantId, tournamentId);
    return res.status(200).json(ok(matches));
  } catch (error) {
    return next(error);
  }
};

export const getTournamentFixturesBracketHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { tournamentId } = tournamentIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const bracket = await getTournamentFixturesBracket(tenantId, tournamentId);
    return res.status(200).json(ok(bracket));
  } catch (error) {
    return next(error);
  }
};

export const getTournamentFixturesViewHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { tournamentId } = tournamentIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const fixturesView = await getTournamentFixturesView(tenantId, tournamentId);
    return res.status(200).json(ok(fixturesView));
  } catch (error) {
    return next(error);
  }
};

export const generateFixturesHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tournamentId } = tournamentIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await generateFixtures(tenantId, tournamentId);
    return res.status(201).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getMatchHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { matchId } = matchIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const match = await getMatchById(tenantId, matchId);
    return res.status(200).json(ok(match));
  } catch (error) {
    return next(error);
  }
};

export const startMatchHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { matchId } = matchIdSchema.parse(req.params);
    const input = startMatchSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const result = await startMatch({ tenantId, matchId, ...input });
    return res.status(201).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getMatchScoreHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { matchId } = matchIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const score = await getMatchScore(tenantId, matchId);
    return res.status(200).json(ok(score));
  } catch (error) {
    return next(error);
  }
};

export const startSecondInningsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { matchId } = matchIdSchema.parse(req.params);
    const input = startSecondInningsSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const result = await startSecondInnings({ tenantId, matchId, ...input });
    return res.status(201).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const changeCurrentBowlerHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { matchId } = matchIdSchema.parse(req.params);
    const { bowlerId } = changeBowlerSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const result = await changeCurrentBowler({ tenantId, matchId, bowlerId });
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const getAvailableNextBattersHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { matchId } = matchIdSchema.parse(req.params);
    const tenantId = getTenantId(req);
    const result = await getAvailableNextBatters(tenantId, matchId);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const updateMatchConfigHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { matchId } = matchIdSchema.parse(req.params);
    const payload = updateMatchConfigSchema.parse(req.body);
    const tenantId = getTenantId(req);
    const result = await updateMatchConfig({ tenantId, matchId, ...payload });
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

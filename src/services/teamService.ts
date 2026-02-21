import { isValidObjectId } from 'mongoose';
import { TeamModel } from '../models/team';
import { TournamentModel } from '../models/tournament';
import { AppError } from '../utils/appError';
import { scopedDeleteOne, scopedFind, scopedFindOne } from '../utils/scopedQuery';

export type TeamCreateInput = {
  tenantId: string;
  tournamentId: string;
  name: string;
  shortName?: string;
};

export type TeamUpdateInput = {
  name?: string;
  shortName?: string;
};

const ensureObjectId = (id: string, message: string) => {
  if (!isValidObjectId(id)) {
    throw new AppError(message, 400, 'validation.invalid_id');
  }
};

const ensureTournament = async (tenantId: string, tournamentId: string) => {
  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: tournamentId });

  if (!tournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  return tournament;
};

export const createTeam = async (input: TeamCreateInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.tournamentId, 'Invalid tournament id.');

  await ensureTournament(input.tenantId, input.tournamentId);

  const team = await TeamModel.create({
    tenantId: input.tenantId,
    tournamentId: input.tournamentId,
    name: input.name,
    shortName: input.shortName
  });

  return team;
};

export const listTeamsByTournament = async (tenantId: string, tournamentId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(tournamentId, 'Invalid tournament id.');

  await ensureTournament(tenantId, tournamentId);

  return scopedFind(TeamModel, tenantId, { tournamentId }).sort({ createdAt: -1 });
};

export const getTeamById = async (tenantId: string, id: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid team id.');

  const team = await scopedFindOne(TeamModel, tenantId, { _id: id });

  if (!team) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }

  return team;
};

export const updateTeam = async (tenantId: string, id: string, updates: TeamUpdateInput) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid team id.');

  const team = await scopedFindOne(TeamModel, tenantId, { _id: id });

  if (!team) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }

  if (updates.name !== undefined) team.name = updates.name;
  if (updates.shortName !== undefined) team.shortName = updates.shortName;

  await team.save();
  return team;
};

export const deleteTeam = async (tenantId: string, id: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid team id.');

  const existing = await scopedFindOne(TeamModel, tenantId, { _id: id });

  if (!existing) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }

  await scopedDeleteOne(TeamModel, tenantId, { _id: id });

  return { id };
};

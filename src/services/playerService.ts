import { isValidObjectId } from 'mongoose';
import type { BattingStyle, BowlingStyle } from '../constants/playerStyles';
import { PlayerModel } from '../models/player';
import { TeamModel } from '../models/team';
import { AppError } from '../utils/appError';
import { scopedDeleteOne, scopedFind, scopedFindOne } from '../utils/scopedQuery';

export type PlayerCreateInput = {
  tenantId: string;
  teamId: string;
  fullName: string;
  jerseyNumber?: number;
  battingStyle?: BattingStyle;
  bowlingStyle?: BowlingStyle;
  isWicketKeeper?: boolean;
};

export type PlayerUpdateInput = {
  fullName?: string;
  jerseyNumber?: number;
  battingStyle?: BattingStyle;
  bowlingStyle?: BowlingStyle;
  isWicketKeeper?: boolean;
};

const ensureObjectId = (id: string, message: string) => {
  if (!isValidObjectId(id)) {
    throw new AppError(message, 400, 'validation.invalid_id');
  }
};

const ensureTeam = async (tenantId: string, teamId: string) => {
  const team = await scopedFindOne(TeamModel, tenantId, { _id: teamId });

  if (!team) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }

  return team;
};

export const createPlayer = async (input: PlayerCreateInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.teamId, 'Invalid team id.');

  await ensureTeam(input.tenantId, input.teamId);

  const player = await PlayerModel.create({
    tenantId: input.tenantId,
    teamId: input.teamId,
    fullName: input.fullName,
    jerseyNumber: input.jerseyNumber,
    battingStyle: input.battingStyle,
    bowlingStyle: input.bowlingStyle,
    isWicketKeeper: input.isWicketKeeper ?? false
  });

  return player;
};

export const listPlayersByTeam = async (tenantId: string, teamId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(teamId, 'Invalid team id.');

  await ensureTeam(tenantId, teamId);

  return scopedFind(PlayerModel, tenantId, { teamId }).sort({ createdAt: -1 });
};

export const getPlayerById = async (tenantId: string, id: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid player id.');

  const player = await scopedFindOne(PlayerModel, tenantId, { _id: id });

  if (!player) {
    throw new AppError('Player not found.', 404, 'player.not_found');
  }

  return player;
};

export const updatePlayer = async (tenantId: string, id: string, updates: PlayerUpdateInput) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid player id.');

  const player = await scopedFindOne(PlayerModel, tenantId, { _id: id });

  if (!player) {
    throw new AppError('Player not found.', 404, 'player.not_found');
  }

  if (updates.fullName !== undefined) player.fullName = updates.fullName;
  if (updates.jerseyNumber !== undefined) player.jerseyNumber = updates.jerseyNumber;
  if (updates.battingStyle !== undefined) player.battingStyle = updates.battingStyle;
  if (updates.bowlingStyle !== undefined) player.bowlingStyle = updates.bowlingStyle;
  if (updates.isWicketKeeper !== undefined) player.isWicketKeeper = updates.isWicketKeeper;

  await player.save();
  return player;
};

export const deletePlayer = async (tenantId: string, id: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid player id.');

  const existing = await scopedFindOne(PlayerModel, tenantId, { _id: id });

  if (!existing) {
    throw new AppError('Player not found.', 404, 'player.not_found');
  }

  await scopedDeleteOne(PlayerModel, tenantId, { _id: id });

  return { id };
};


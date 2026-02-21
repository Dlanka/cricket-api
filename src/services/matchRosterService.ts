import { isValidObjectId } from 'mongoose';
import { MatchModel } from '../models/match';
import { MatchPlayerModel } from '../models/matchPlayer';
import { PlayerModel } from '../models/player';
import { AppError } from '../utils/appError';
import { scopedDeleteMany, scopedFind, scopedFindOne } from '../utils/scopedQuery';

export type RosterInput = {
  tenantId: string;
  matchId: string;
  teamId: string;
  playingPlayerIds: string[];
  captainId?: string;
  keeperId?: string;
};

const ensureObjectId = (id: string, message: string) => {
  if (!isValidObjectId(id)) {
    throw new AppError(message, 400, 'validation.invalid_id');
  }
};

const ensureMatch = async (tenantId: string, matchId: string) => {
  const match = await scopedFindOne(MatchModel, tenantId, { _id: matchId });
  if (!match) {
    throw new AppError('Match not found.', 404, 'match.not_found');
  }
  return match;
};

const ensureTeamInMatch = (match: { teamAId: unknown; teamBId?: unknown | null }, teamId: string) => {
  const teamA = match.teamAId?.toString();
  const teamB = match.teamBId?.toString();
  if (teamId !== teamA && teamId !== teamB) {
    throw new AppError('Team does not belong to match.', 400, 'match.team_invalid');
  }
};

export const replaceRoster = async (input: RosterInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.matchId, 'Invalid match id.');
  ensureObjectId(input.teamId, 'Invalid team id.');

  if (input.playingPlayerIds.length < 1 || input.playingPlayerIds.length > 11) {
    throw new AppError(
      'Playing roster must include between 1 and 11 players.',
      400,
      'match.roster_size_invalid'
    );
  }

  input.playingPlayerIds.forEach((id) => ensureObjectId(id, 'Invalid player id.'));
  if (input.captainId) ensureObjectId(input.captainId, 'Invalid captain id.');
  if (input.keeperId) ensureObjectId(input.keeperId, 'Invalid keeper id.');

  const match = await ensureMatch(input.tenantId, input.matchId);
  ensureTeamInMatch(match, input.teamId);

  const players = await scopedFind(PlayerModel, input.tenantId, {
    _id: { $in: input.playingPlayerIds },
    teamId: input.teamId
  });

  if (players.length !== input.playingPlayerIds.length) {
    throw new AppError('Some players are not part of the team.', 400, 'match.roster_invalid');
  }

  if (input.captainId && !input.playingPlayerIds.includes(input.captainId)) {
    throw new AppError('Captain must be in playing roster.', 400, 'match.captain_invalid');
  }

  if (input.keeperId && !input.playingPlayerIds.includes(input.keeperId)) {
    throw new AppError('Keeper must be in playing roster.', 400, 'match.keeper_invalid');
  }

  await scopedDeleteMany(MatchPlayerModel, input.tenantId, {
    matchId: input.matchId,
    teamId: input.teamId
  });

  const rosterEntries = input.playingPlayerIds.map((playerId) => ({
    tenantId: input.tenantId,
    matchId: input.matchId,
    teamId: input.teamId,
    playerId,
    isPlaying: true,
    isCaptain: input.captainId === playerId,
    isKeeper: input.keeperId === playerId
  }));

  await MatchPlayerModel.insertMany(rosterEntries);

  return { count: rosterEntries.length };
};

export const getRosterByMatch = async (tenantId: string, matchId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(matchId, 'Invalid match id.');

  await ensureMatch(tenantId, matchId);

  const roster = await scopedFind(MatchPlayerModel, tenantId, { matchId });

  const grouped: Record<string, typeof roster> = {};
  roster.forEach((entry) => {
    const teamId = entry.teamId.toString();
    grouped[teamId] = grouped[teamId] ?? [];
    grouped[teamId].push(entry);
  });

  return grouped;
};

import { isValidObjectId } from 'mongoose';
import { TeamModel } from '../models/team';
import { TeamAccessLinkModel } from '../models/teamAccessLink';
import { TournamentModel } from '../models/tournament';
import { AppError } from '../utils/appError';
import { scopedDeleteOne, scopedFind, scopedFindOne } from '../utils/scopedQuery';

export type TeamCreateInput = {
  tenantId: string;
  tournamentId: string;
  name: string;
  shortName?: string;
  contactPerson?: string;
  contactNumber?: string;
};

export type TeamUpdateInput = {
  name?: string;
  shortName?: string;
  contactPerson?: string | null;
  contactNumber?: string | null;
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
  const lastTeam = await TeamModel.findOne({
    tenantId: input.tenantId,
    tournamentId: input.tournamentId
  })
    .sort({ sortOrder: -1, createdAt: -1 })
    .select({ sortOrder: 1 });
  const nextSortOrder = (lastTeam?.sortOrder ?? -1) + 1;

  const team = await TeamModel.create({
    tenantId: input.tenantId,
    tournamentId: input.tournamentId,
    name: input.name,
    shortName: input.shortName,
    contactPerson: input.contactPerson,
    contactNumber: input.contactNumber,
    sortOrder: nextSortOrder
  });

  return team;
};

export const listTeamsByTournament = async (tenantId: string, tournamentId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(tournamentId, 'Invalid tournament id.');

  await ensureTournament(tenantId, tournamentId);

  return scopedFind(TeamModel, tenantId, { tournamentId }).sort({ sortOrder: 1, createdAt: 1 });
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
  if (updates.contactPerson !== undefined) team.contactPerson = updates.contactPerson ?? undefined;
  if (updates.contactNumber !== undefined) team.contactNumber = updates.contactNumber ?? undefined;

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
  await TeamAccessLinkModel.deleteMany({ tenantId, teamId: id });

  return { id };
};

export const reorderTeamsByTournament = async (
  tenantId: string,
  tournamentId: string,
  orderedTeamIds: string[]
) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(tournamentId, 'Invalid tournament id.');
  if (orderedTeamIds.some((id) => !isValidObjectId(id))) {
    throw new AppError('Invalid team id in ordered list.', 400, 'validation.invalid_id');
  }

  const tournament = await ensureTournament(tenantId, tournamentId);
  if (tournament.type !== 'KNOCKOUT' && tournament.type !== 'LEAGUE_KNOCKOUT') {
    throw new AppError(
      'Team reorder is allowed only for Knockout and League + Knockout tournaments.',
      409,
      'team.reorder_not_allowed'
    );
  }

  const teams = await scopedFind(TeamModel, tenantId, { tournamentId }).select({ _id: 1 });
  const uniqueOrderedTeamIds = [...new Set(orderedTeamIds)];
  const teamIds = teams.map((team) => team._id.toString());

  if (uniqueOrderedTeamIds.length !== teams.length) {
    throw new AppError(
      'Team order must include each team exactly once.',
      400,
      'team.invalid_order'
    );
  }

  const idSet = new Set(teamIds);
  const hasUnknown = uniqueOrderedTeamIds.some((id) => !idSet.has(id));
  if (hasUnknown) {
    throw new AppError(
      'Team order contains unknown team ids.',
      400,
      'team.invalid_order'
    );
  }

  await TeamModel.bulkWrite(
    uniqueOrderedTeamIds.map((teamId, index) => ({
      updateOne: {
        filter: { tenantId, tournamentId, _id: teamId },
        update: { $set: { sortOrder: index } }
      }
    }))
  );

  return { updated: uniqueOrderedTeamIds.length };
};

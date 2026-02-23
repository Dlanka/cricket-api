import crypto from 'crypto';
import { isValidObjectId } from 'mongoose';
import type { BattingStyle, BowlingStyle } from '../constants/playerStyles';
import { env } from '../config/env';
import { PlayerModel } from '../models/player';
import { TeamAccessLinkModel } from '../models/teamAccessLink';
import { TeamModel } from '../models/team';
import { TournamentModel } from '../models/tournament';
import { AppError } from '../utils/appError';
import { scopedFind, scopedFindOne } from '../utils/scopedQuery';

export type CreateTeamAccessLinkInput = {
  tenantId: string;
  teamId: string;
  createdByUserId?: string;
  expiresInHours?: number;
};

export type TeamAccessPlayerCreateInput = {
  fullName: string;
  jerseyNumber?: number;
  battingStyle?: BattingStyle;
  bowlingStyle?: BowlingStyle;
  isWicketKeeper?: boolean;
};

export type TeamAccessPlayerUpdateInput = {
  fullName?: string;
  jerseyNumber?: number;
  battingStyle?: BattingStyle;
  bowlingStyle?: BowlingStyle;
  isWicketKeeper?: boolean;
};

export type CreateTeamAccessWhatsappShareInput = {
  tenantId: string;
  teamId: string;
  createdByUserId?: string;
  expiresInHours?: number;
  phoneNumber?: string;
};

const DEFAULT_EXPIRES_IN_HOURS = 168;

const ensureObjectId = (id: string, message: string) => {
  if (!isValidObjectId(id)) {
    throw new AppError(message, 400, 'validation.invalid_id');
  }
};

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const normalizePhoneForWhatsapp = (value: string) => value.replace(/[^0-9]/g, '');
const baseFrontendUrl = () => (env.FRONTEND_BASE_URL ?? env.CORS_ORIGIN).replace(/\/+$/, '');
const toExpiryLabel = (date: Date) => new Date(date).toLocaleString('en-US', { timeZone: 'UTC' });

const ensureTeam = async (tenantId: string, teamId: string) => {
  const team = await scopedFindOne(TeamModel, tenantId, { _id: teamId });
  if (!team) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }
  return team;
};

const resolveAccessLink = async (token: string) => {
  const tokenHash = hashToken(token);
  const now = new Date();
  const accessLink = await TeamAccessLinkModel.findOne({
    tokenHash,
    revokedAt: { $exists: false },
    expiresAt: { $gt: now }
  });

  if (!accessLink) {
    throw new AppError('Team access link is invalid or expired.', 401, 'team_access.invalid_token');
  }

  const team = await TeamModel.findOne({
    _id: accessLink.teamId,
    tenantId: accessLink.tenantId
  });

  if (!team) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }

  return { accessLink, team };
};

export const createTeamAccessLink = async (input: CreateTeamAccessLinkInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.teamId, 'Invalid team id.');
  if (input.createdByUserId) {
    ensureObjectId(input.createdByUserId, 'Invalid user id.');
  }

  await ensureTeam(input.tenantId, input.teamId);

  // Keep only one active link per team. Regenerating rotates the previous link out.
  await TeamAccessLinkModel.updateMany(
    {
      tenantId: input.tenantId,
      teamId: input.teamId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() }
    },
    { $set: { revokedAt: new Date() } }
  );

  const expiresInHours = input.expiresInHours ?? DEFAULT_EXPIRES_IN_HOURS;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);

  const link = await TeamAccessLinkModel.create({
    tenantId: input.tenantId,
    teamId: input.teamId,
    token,
    tokenHash,
    expiresAt,
    createdByUserId: input.createdByUserId
  });

  return {
    id: link._id.toString(),
    teamId: link.teamId.toString(),
    token,
    expiresAt: link.expiresAt
  };
};

const buildSharePayload = (params: {
  token: string;
  team: {
    _id: { toString(): string };
    name: string;
    contactNumber?: string | null;
  };
  tournamentName?: string;
  expiresAt: Date;
  phoneNumber?: string | null;
}) => {
  const phoneRaw = params.phoneNumber ?? params.team.contactNumber ?? null;
  const phoneNumber = phoneRaw ? normalizePhoneForWhatsapp(phoneRaw) : null;
  const accessUrl = `${baseFrontendUrl()}/team-access/${params.token}`;
  const textParts = [
    `Team access link for ${params.team.name}.`,
    params.tournamentName ? `Tournament: ${params.tournamentName}.` : undefined,
    `Use this link to manage players: ${accessUrl}`,
    `Expires: ${toExpiryLabel(params.expiresAt)} UTC`
  ].filter(Boolean);
  const message = textParts.join(' ');
  const whatsappUrl = phoneNumber ? `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}` : null;

  return { phoneNumber, accessUrl, message, whatsappUrl };
};

export const createTeamAccessWhatsappShare = async (input: CreateTeamAccessWhatsappShareInput) => {
  const team = await ensureTeam(input.tenantId, input.teamId);
  const created = await createTeamAccessLink({
    tenantId: input.tenantId,
    teamId: input.teamId,
    createdByUserId: input.createdByUserId,
    expiresInHours: input.expiresInHours
  });

  const tournament = await scopedFindOne(TournamentModel, input.tenantId, { _id: team.tournamentId });
  const phoneRaw = input.phoneNumber ?? team.contactNumber;
  if (!phoneRaw) {
    throw new AppError(
      'Phone number is required to generate WhatsApp share link.',
      400,
      'team_access.phone_missing'
    );
  }

  const phoneNumber = normalizePhoneForWhatsapp(phoneRaw);
  if (!phoneNumber) {
    throw new AppError('Invalid phone number for WhatsApp link.', 400, 'team_access.phone_invalid');
  }
  const shared = buildSharePayload({
    token: created.token,
    team,
    tournamentName: tournament?.name,
    expiresAt: created.expiresAt,
    phoneNumber
  });

  return {
    ...created,
    ...shared
  };
};

export const listTeamAccessLinks = async (tenantId: string, teamId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(teamId, 'Invalid team id.');
  const team = await ensureTeam(tenantId, teamId);
  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: team.tournamentId });

  const links = await scopedFind(TeamAccessLinkModel, tenantId, {
    teamId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
  return links.map((entry) => ({
    id: entry._id.toString(),
    teamId: entry.teamId.toString(),
    expiresAt: entry.expiresAt,
    ...(entry.token
      ? buildSharePayload({
          token: entry.token,
          team,
          tournamentName: tournament?.name,
          expiresAt: entry.expiresAt
        })
      : {
          phoneNumber: null,
          accessUrl: null,
          message: null,
          whatsappUrl: null
        }),
    lastUsedAt: entry.lastUsedAt ?? null,
    createdAt: entry.createdAt
  }));
};

export const getCurrentTeamAccessShare = async (tenantId: string, teamId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(teamId, 'Invalid team id.');
  const team = await ensureTeam(tenantId, teamId);
  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: team.tournamentId });

  const link = await scopedFindOne(TeamAccessLinkModel, tenantId, {
    teamId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() }
  });

  if (!link || !link.token) {
    return null;
  }

  return {
    id: link._id.toString(),
    teamId: link.teamId.toString(),
    expiresAt: link.expiresAt,
    ...buildSharePayload({
      token: link.token,
      team,
      tournamentName: tournament?.name,
      expiresAt: link.expiresAt
    })
  };
};

export const revokeTeamAccessLink = async (tenantId: string, teamId: string, linkId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(teamId, 'Invalid team id.');
  ensureObjectId(linkId, 'Invalid link id.');
  await ensureTeam(tenantId, teamId);

  const link = await scopedFindOne(TeamAccessLinkModel, tenantId, { _id: linkId, teamId });
  if (!link) {
    throw new AppError('Team access link not found.', 404, 'team_access.not_found');
  }

  if (!link.revokedAt) {
    link.revokedAt = new Date();
    await link.save();
  }

  return { id: link._id.toString(), revokedAt: link.revokedAt };
};

export const getTeamAccessContext = async (token: string) => {
  if (!token || token.length < 10) {
    throw new AppError('Team access link is invalid.', 401, 'team_access.invalid_token');
  }

  const { accessLink, team } = await resolveAccessLink(token);
  const tenantId = team.tenantId.toString();
  const [players, tournament] = await Promise.all([
    scopedFind(PlayerModel, tenantId, { teamId: team._id }).sort({ createdAt: -1 }),
    scopedFindOne(TournamentModel, tenantId, { _id: team.tournamentId })
  ]);

  accessLink.lastUsedAt = new Date();
  await accessLink.save();

  return {
    tournament: tournament
      ? {
          id: tournament._id.toString(),
          name: tournament.name,
          type: tournament.type,
          status: tournament.status,
          oversPerInnings: tournament.oversPerInnings,
          ballsPerOver: tournament.ballsPerOver ?? 6,
          startDate: tournament.startDate ?? null,
          endDate: tournament.endDate ?? null
        }
      : null,
    team: {
      id: team._id.toString(),
      name: team.name,
      shortName: team.shortName ?? null,
      contactPerson: team.contactPerson ?? null,
      contactNumber: team.contactNumber ?? null
    },
    players
  };
};

export const createPlayerViaAccessLink = async (token: string, input: TeamAccessPlayerCreateInput) => {
  const { accessLink, team } = await resolveAccessLink(token);

  const player = await PlayerModel.create({
    tenantId: team.tenantId,
    teamId: team._id,
    fullName: input.fullName,
    jerseyNumber: input.jerseyNumber,
    battingStyle: input.battingStyle,
    bowlingStyle: input.bowlingStyle,
    isWicketKeeper: input.isWicketKeeper ?? false
  });

  accessLink.lastUsedAt = new Date();
  await accessLink.save();

  return player;
};

export const updatePlayerViaAccessLink = async (
  token: string,
  playerId: string,
  updates: TeamAccessPlayerUpdateInput
) => {
  ensureObjectId(playerId, 'Invalid player id.');
  const { accessLink, team } = await resolveAccessLink(token);

  const player = await scopedFindOne(PlayerModel, team.tenantId.toString(), {
    _id: playerId,
    teamId: team._id
  });

  if (!player) {
    throw new AppError('Player not found.', 404, 'player.not_found');
  }

  if (updates.fullName !== undefined) player.fullName = updates.fullName;
  if (updates.jerseyNumber !== undefined) player.jerseyNumber = updates.jerseyNumber;
  if (updates.battingStyle !== undefined) player.battingStyle = updates.battingStyle;
  if (updates.bowlingStyle !== undefined) player.bowlingStyle = updates.bowlingStyle;
  if (updates.isWicketKeeper !== undefined) player.isWicketKeeper = updates.isWicketKeeper;

  await player.save();

  accessLink.lastUsedAt = new Date();
  await accessLink.save();

  return player;
};

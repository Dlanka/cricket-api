import { isValidObjectId } from 'mongoose';
import { InningsModel } from '../models/innings';
import { MatchModel } from '../models/match';
import { MatchPlayerModel } from '../models/matchPlayer';
import { PlayerModel } from '../models/player';
import { ScoreEventModel } from '../models/scoreEvent';
import { TeamModel } from '../models/team';
import { TournamentModel } from '../models/tournament';
import { InningsBatterModel } from '../models/inningsBatter';
import { AppError } from '../utils/appError';
import { scopedFind, scopedFindOne } from '../utils/scopedQuery';

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

const ensureMatch = async (tenantId: string, matchId: string) => {
  const match = await scopedFindOne(MatchModel, tenantId, { _id: matchId });

  if (!match) {
    throw new AppError('Match not found.', 404, 'match.not_found');
  }

  return match;
};

const shuffle = <T>(items: T[]) => {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

const generateRoundRobinRounds = (teamIds: string[]) => {
  const hasOddTeams = teamIds.length % 2 === 1;
  const slots = hasOddTeams ? [...teamIds, null] : [...teamIds];
  const totalRounds = slots.length - 1;
  const half = slots.length / 2;
  const rounds: Array<Array<{ teamAId: string; teamBId: string }>> = [];

  for (let roundIndex = 0; roundIndex < totalRounds; roundIndex += 1) {
    const roundMatches: Array<{ teamAId: string; teamBId: string }> = [];

    for (let pairIndex = 0; pairIndex < half; pairIndex += 1) {
      const home = slots[pairIndex];
      const away = slots[slots.length - 1 - pairIndex];
      if (!home || !away) continue;

      roundMatches.push(
        roundIndex % 2 === 0
          ? { teamAId: home, teamBId: away }
          : { teamAId: away, teamBId: home }
      );
    }

    rounds.push(roundMatches);

    const fixed = slots[0];
    const rotating = slots.slice(1);
    rotating.unshift(rotating.pop() ?? null);
    slots.splice(0, slots.length, fixed, ...rotating);
  }

  return rounds;
};

const formatOvers = (balls: number, ballsPerOver: number) => {
  const completedOvers = Math.floor(balls / ballsPerOver);
  const ballsInOver = balls % ballsPerOver;
  return `${completedOvers}.${ballsInOver}`;
};

const ensureTeamIdsInMatch = (
  match: { teamAId: unknown; teamBId?: unknown | null },
  battingTeamId: string,
  bowlingTeamId: string
) => {
  const teamA = match.teamAId?.toString();
  const teamB = match.teamBId?.toString();

  if (!teamB) {
    throw new AppError('Match requires two teams to start.', 400, 'match.invalid_teams');
  }

  const matchTeams = new Set([teamA, teamB]);
  if (!matchTeams.has(battingTeamId) || !matchTeams.has(bowlingTeamId)) {
    throw new AppError('Batting or bowling team is invalid for this match.', 400, 'match.team_invalid');
  }

  if (battingTeamId === bowlingTeamId) {
    throw new AppError('Batting and bowling teams must be different.', 400, 'match.team_invalid');
  }
};

const resolveCurrentBatterId = async (tenantId: string, inningsId: string, onFieldId: string) => {
  const direct = await scopedFindOne(InningsBatterModel, tenantId, {
    _id: onFieldId,
    inningsId
  });
  if (direct) {
    return direct._id.toString();
  }

  const byPlayer = await scopedFindOne(InningsBatterModel, tenantId, {
    inningsId,
    $or: [{ 'playerRef.playerId': onFieldId }, { 'batterKey.playerId': onFieldId }]
  });

  return byPlayer?._id.toString() ?? onFieldId;
};

type KnockoutStage = 'R1' | 'QF' | 'SF' | 'FINAL';
type MatchStage = 'LEAGUE' | KnockoutStage;

const knockoutStageOrder: KnockoutStage[] = ['R1', 'QF', 'SF', 'FINAL'];
const matchStageOrder: MatchStage[] = ['LEAGUE', 'R1', 'QF', 'SF', 'FINAL'];

const isKnockoutStage = (stage: string): stage is KnockoutStage =>
  stage === 'R1' || stage === 'QF' || stage === 'SF' || stage === 'FINAL';

const resolveNextKnockoutStage = (winnerCount: number): KnockoutStage | null => {
  if (winnerCount > 8) return 'R1';
  if (winnerCount > 4) return 'QF';
  if (winnerCount > 2) return 'SF';
  if (winnerCount > 1) return 'FINAL';
  return null;
};

const compareKnockoutRounds = (
  a: { stage: KnockoutStage; roundNumber: number },
  b: { stage: KnockoutStage; roundNumber: number }
) => {
  if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
  return knockoutStageOrder.indexOf(a.stage) - knockoutStageOrder.indexOf(b.stage);
};

const compareMatchesForView = (
  a: {
    stage: MatchStage;
    roundNumber?: number | null;
    scheduledAt?: Date | null;
    createdAt?: Date | null;
  },
  b: {
    stage: MatchStage;
    roundNumber?: number | null;
    scheduledAt?: Date | null;
    createdAt?: Date | null;
  }
) => {
  const stageDelta = matchStageOrder.indexOf(a.stage) - matchStageOrder.indexOf(b.stage);
  if (stageDelta !== 0) return stageDelta;

  const roundA = a.roundNumber ?? 1;
  const roundB = b.roundNumber ?? 1;
  if (roundA !== roundB) return roundA - roundB;

  if (a.scheduledAt && b.scheduledAt) {
    const scheduledDelta = a.scheduledAt.getTime() - b.scheduledAt.getTime();
    if (scheduledDelta !== 0) return scheduledDelta;
  }

  if (a.scheduledAt && !b.scheduledAt) return -1;
  if (!a.scheduledAt && b.scheduledAt) return 1;

  const createdA = a.createdAt?.getTime() ?? 0;
  const createdB = b.createdAt?.getTime() ?? 0;
  return createdA - createdB;
};

export const listMatchesByTournament = async (tenantId: string, tournamentId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(tournamentId, 'Invalid tournament id.');

  await ensureTournament(tenantId, tournamentId);

  return scopedFind(MatchModel, tenantId, { tournamentId }).sort({ createdAt: 1 });
};

export const getTournamentFixturesBracket = async (tenantId: string, tournamentId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(tournamentId, 'Invalid tournament id.');

  const tournament = await ensureTournament(tenantId, tournamentId);
  const [teams, matches] = await Promise.all([
    scopedFind(TeamModel, tenantId, { tournamentId }).sort({ createdAt: 1 }),
    scopedFind(MatchModel, tenantId, { tournamentId }).sort({ createdAt: 1 })
  ]);

  const teamMap = new Map(
    teams.map((team) => [
      team._id.toString(),
      {
        id: team._id.toString(),
        name: team.name,
        shortName: team.shortName ?? null
      }
    ])
  );

  const knockoutMatches = matches.filter((entry) => isKnockoutStage(entry.stage));
  const roundsFromMatches = new Map<string, typeof knockoutMatches>();
  knockoutMatches.forEach((entry) => {
    const roundNumber = entry.roundNumber ?? 1;
    const key = `${entry.stage}:${roundNumber}`;
    const rows = roundsFromMatches.get(key) ?? [];
    rows.push(entry);
    roundsFromMatches.set(key, rows);
  });

  const plannedRounds: Array<{ stage: KnockoutStage; roundNumber: number; slots: number }> = [];

  if (tournament.type === 'KNOCKOUT') {
    let teamsRemaining = teams.length;
    let currentStage: KnockoutStage = 'R1';
    let roundNumber = 1;

    while (teamsRemaining > 1) {
      const slots = Math.ceil(teamsRemaining / 2);
      plannedRounds.push({ stage: currentStage, roundNumber, slots });
      const winners = slots;
      if (winners <= 1) break;
      const nextStage = resolveNextKnockoutStage(winners);
      if (!nextStage) break;
      teamsRemaining = winners;
      currentStage = nextStage;
      roundNumber += 1;
    }
  }

  if (tournament.type === 'LEAGUE_KNOCKOUT') {
    const configuredCount = tournament.rules?.qualificationCount ?? 4;
    const hasSemis = configuredCount >= 4;
    if (hasSemis) {
      plannedRounds.push({ stage: 'SF', roundNumber: 1, slots: 2 });
      plannedRounds.push({ stage: 'FINAL', roundNumber: 2, slots: 1 });
    } else {
      plannedRounds.push({ stage: 'FINAL', roundNumber: 1, slots: 1 });
    }
  }

  const plannedRoundMap = new Map(plannedRounds.map((entry) => [`${entry.stage}:${entry.roundNumber}`, entry]));
  roundsFromMatches.forEach((rows, key) => {
    if (plannedRoundMap.has(key) || rows.length === 0) return;
    const stage = rows[0].stage;
    if (!isKnockoutStage(stage)) return;
    plannedRoundMap.set(key, {
      stage,
      roundNumber: rows[0].roundNumber ?? 1,
      slots: rows.length
    });
  });

  const rounds = [...plannedRoundMap.values()].sort(compareKnockoutRounds);

  return {
    tournamentId,
    tournamentType: tournament.type,
    rounds: rounds.map((round) => {
      const key = `${round.stage}:${round.roundNumber}`;
      const existing = roundsFromMatches.get(key) ?? [];
      const slotCount = Math.max(round.slots, existing.length);
      const fixtures = Array.from({ length: slotCount }, (_, index) => {
        const match = existing[index];
        if (!match) {
          return {
            slot: index + 1,
            isPlaceholder: true,
            matchId: null,
            status: 'TBD',
            teamA: null,
            teamB: null,
            winnerTeamId: null,
            isBye: false
          };
        }

        return {
          slot: index + 1,
          isPlaceholder: false,
          matchId: match._id.toString(),
          status: match.status,
          teamA: teamMap.get(match.teamAId.toString()) ?? null,
          teamB: match.teamBId ? teamMap.get(match.teamBId.toString()) ?? null : null,
          winnerTeamId: match.result?.winnerTeamId?.toString() ?? null,
          isBye: !match.teamBId
        };
      });

      return {
        stage: round.stage,
        roundNumber: round.roundNumber,
        fixtures
      };
    })
  };
};

export const getTournamentFixturesView = async (tenantId: string, tournamentId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(tournamentId, 'Invalid tournament id.');

  const [tournament, teams, matches, bracket] = await Promise.all([
    ensureTournament(tenantId, tournamentId),
    scopedFind(TeamModel, tenantId, { tournamentId }).sort({ createdAt: 1 }),
    scopedFind(MatchModel, tenantId, { tournamentId }).sort({ createdAt: 1 }),
    getTournamentFixturesBracket(tenantId, tournamentId)
  ]);

  const teamMap = new Map(
    teams.map((team) => [
      team._id.toString(),
      {
        id: team._id.toString(),
        name: team.name,
        shortName: team.shortName ?? null
      }
    ])
  );

  const viewMatches = matches
    .map((entry) => {
      const stage = entry.stage as MatchStage;
      return {
        id: entry._id.toString(),
        tournamentId: entry.tournamentId.toString(),
        stage,
        roundNumber: entry.roundNumber ?? 1,
        status: entry.status,
        scheduledAt: entry.scheduledAt ? entry.scheduledAt.toISOString() : null,
        createdAt: (entry.createdAt ?? entry.updatedAt ?? new Date(0)).toISOString(),
        teamAId: entry.teamAId?.toString() ?? null,
        teamBId: entry.teamBId?.toString() ?? null,
        teamA: teamMap.get(entry.teamAId?.toString()) ?? null,
        teamB: entry.teamBId ? teamMap.get(entry.teamBId.toString()) ?? null : null,
        result: {
          winnerTeamId: entry.result?.winnerTeamId?.toString() ?? null,
          winByRuns: entry.result?.winByRuns ?? null,
          winByWkts: entry.result?.winByWickets ?? entry.result?.winByWkts ?? null,
          isNoResult: entry.result?.isNoResult ?? null
        }
      };
    })
    .sort((a, b) =>
      compareMatchesForView(
        {
          stage: a.stage,
          roundNumber: a.roundNumber,
          scheduledAt: a.scheduledAt ? new Date(a.scheduledAt) : null,
          createdAt: new Date(a.createdAt)
        },
        {
          stage: b.stage,
          roundNumber: b.roundNumber,
          scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null,
          createdAt: new Date(b.createdAt)
        }
      )
    );

  return {
    version: 1,
    tournamentId: tournament._id.toString(),
    tournamentType: tournament.type,
    stageStatus: {
      league: tournament.stageStatus?.league ?? 'PENDING',
      knockout: tournament.stageStatus?.knockout ?? 'PENDING'
    },
    matches: viewMatches,
    bracket: {
      rounds: bracket.rounds
    }
  };
};

export const getMatchById = async (tenantId: string, matchId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(matchId, 'Invalid match id.');

  const match = await ensureMatch(tenantId, matchId);
  const tournament = await ensureTournament(tenantId, match.tournamentId.toString());

  const [teamA, teamB] = await Promise.all([
    scopedFindOne(TeamModel, tenantId, { _id: match.teamAId }),
    match.teamBId ? scopedFindOne(TeamModel, tenantId, { _id: match.teamBId }) : Promise.resolve(null)
  ]);

  if (!teamA) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }

  if (match.teamBId && !teamB) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }

  return {
    matchId: match._id.toString(),
    tournamentId: match.tournamentId.toString(),
    teams: {
      teamA: {
        id: teamA._id.toString(),
        name: teamA.name,
        shortName: teamA.shortName
      },
      teamB: teamB
        ? {
            id: teamB._id.toString(),
            name: teamB.name,
            shortName: teamB.shortName
          }
        : null
    },
    oversPerInnings: match.oversPerInnings ?? tournament.oversPerInnings,
    ballsPerOver: match.ballsPerOver ?? tournament.ballsPerOver ?? 6,
    status: match.status,
    stage: match.stage,
    scheduledAt: match.scheduledAt,
    currentInningsId: match.currentInningsId?.toString()
  };
};

export const updateMatchConfig = async (input: UpdateMatchConfigInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.matchId, 'Invalid match id.');

  const match = await ensureMatch(input.tenantId, input.matchId);

  if (match.status !== 'SCHEDULED') {
    throw new AppError('Match config can be changed only while scheduled.', 409, 'match.invalid_state');
  }

  const [innings, scoreEvent] = await Promise.all([
    scopedFindOne(InningsModel, input.tenantId, { matchId: input.matchId }),
    scopedFindOne(ScoreEventModel, input.tenantId, { matchId: input.matchId })
  ]);

  if (innings || scoreEvent) {
    throw new AppError(
      'Match config is locked because innings or score events already exist.',
      409,
      'match.config_locked'
    );
  }

  if (input.oversPerInnings !== undefined) {
    match.oversPerInnings = input.oversPerInnings;
  }

  if (input.ballsPerOver !== undefined) {
    match.ballsPerOver = input.ballsPerOver;
  }

  await match.save();

  return {
    matchId: match._id.toString(),
    oversPerInnings: match.oversPerInnings,
    ballsPerOver: match.ballsPerOver,
    status: match.status
  };
};

export const generateFixtures = async (tenantId: string, tournamentId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(tournamentId, 'Invalid tournament id.');

  const tournament = await ensureTournament(tenantId, tournamentId);

  const existing = await scopedFindOne(MatchModel, tenantId, { tournamentId });
  if (existing) {
    throw new AppError('Matches already exist for this tournament.', 409, 'match.already_exists');
  }

  const teams = await scopedFind(TeamModel, tenantId, { tournamentId }).sort({ createdAt: 1 });

  if (teams.length < 2) {
    throw new AppError('At least two teams are required to generate fixtures.', 400, 'match.insufficient_teams');
  }

  if (tournament.type === 'LEAGUE' || tournament.type === 'LEAGUE_KNOCKOUT') {
    const rounds = generateRoundRobinRounds(teams.map((team) => team._id.toString()));
    const matches = [] as Array<{
      tenantId: string;
      tournamentId: string;
      teamAId: string;
      teamBId: string;
      stage: 'LEAGUE';
      status: 'SCHEDULED';
      roundNumber: number;
      oversPerInnings: number;
      ballsPerOver: number;
    }>;

    rounds.forEach((roundMatches, index) => {
      roundMatches.forEach((fixture) => {
        matches.push({
          tenantId,
          tournamentId,
          teamAId: fixture.teamAId,
          teamBId: fixture.teamBId,
          stage: 'LEAGUE',
          status: 'SCHEDULED',
          roundNumber: index + 1,
          oversPerInnings: tournament.oversPerInnings,
          ballsPerOver: tournament.ballsPerOver ?? 6
        });
      });
    });

    await MatchModel.insertMany(matches);
    return { created: matches.length };
  }

  if (tournament.type === 'KNOCKOUT') {
    const shuffled = shuffle(teams);
    const matches: Array<{
      tenantId: string;
      tournamentId: string;
      teamAId: string;
      teamBId?: string | null;
      stage: 'R1';
      roundNumber: number;
      status: 'SCHEDULED' | 'COMPLETED';
      oversPerInnings: number;
      ballsPerOver: number;
      result?: {
        winnerTeamId?: string;
        isNoResult?: boolean;
      };
    }> = [];

    let index = 0;

    if (shuffled.length % 2 === 1) {
      const byeTeam = shuffled[0];
      matches.push({
        tenantId,
        tournamentId,
        teamAId: byeTeam._id.toString(),
        teamBId: null,
        stage: 'R1',
        roundNumber: 1,
        status: 'COMPLETED',
        oversPerInnings: tournament.oversPerInnings,
        ballsPerOver: tournament.ballsPerOver ?? 6,
        result: {
          winnerTeamId: byeTeam._id.toString(),
          isNoResult: false
        }
      });
      index = 1;
    }

    for (let i = index; i < shuffled.length; i += 2) {
      const teamA = shuffled[i];
      const teamB = shuffled[i + 1];
      if (!teamB) break;
      matches.push({
        tenantId,
        tournamentId,
        teamAId: teamA._id.toString(),
        teamBId: teamB._id.toString(),
        stage: 'R1',
        roundNumber: 1,
        status: 'SCHEDULED',
        oversPerInnings: tournament.oversPerInnings,
        ballsPerOver: tournament.ballsPerOver ?? 6
      });
    }

    await MatchModel.insertMany(matches);
    return { created: matches.length };
  }

  throw new AppError('Unsupported tournament type.', 400, 'match.unsupported_type');
};

export type StartMatchInput = {
  tenantId: string;
  matchId: string;
  battingTeamId: string;
  bowlingTeamId: string;
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
};

export type StartSecondInningsInput = {
  tenantId: string;
  matchId: string;
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
};

export type ChangeCurrentBowlerInput = {
  tenantId: string;
  matchId: string;
  bowlerId: string;
};

export type UpdateMatchConfigInput = {
  tenantId: string;
  matchId: string;
  oversPerInnings?: number;
  ballsPerOver?: number;
};

export const getAvailableNextBatters = async (tenantId: string, matchId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(matchId, 'Invalid match id.');

  const match = await ensureMatch(tenantId, matchId);

  if (match.status !== 'LIVE') {
    throw new AppError('Match is not live.', 409, 'match.invalid_state');
  }

  if (!match.currentInningsId) {
    throw new AppError('Match has no active innings.', 409, 'innings.not_started');
  }

  const innings = await scopedFindOne(InningsModel, tenantId, {
    _id: match.currentInningsId,
    matchId,
    status: 'LIVE'
  });

  if (!innings) {
    throw new AppError('Innings not found.', 404, 'innings.not_found');
  }

  const roster = await scopedFind(MatchPlayerModel, tenantId, {
    matchId,
    teamId: innings.battingTeamId,
    isPlaying: true
  }).sort({ createdAt: 1 });

  if (roster.length === 0) {
    throw new AppError('Batting roster is missing.', 400, 'match.roster_missing');
  }

  const inningsBatters = await scopedFind(InningsBatterModel, tenantId, {
    inningsId: innings._id
  });

  const outPlayerIds = new Set(
    inningsBatters
      .filter((entry) => entry.isOut && entry.playerRef?.playerId)
      .map((entry) => entry.playerRef?.playerId?.toString())
      .filter((playerId): playerId is string => Boolean(playerId))
  );

  const rosterPlayerIds = new Set(roster.map((entry) => entry.playerId.toString()));
  const inningsBatterByDocId = new Map(
    inningsBatters.map((entry) => [entry._id.toString(), entry.playerRef?.playerId?.toString()])
  );

  const toOnFieldPlayerId = (rawId: string) => {
    if (rosterPlayerIds.has(rawId)) {
      return rawId;
    }

    const mappedPlayerId = inningsBatterByDocId.get(rawId);
    return mappedPlayerId ?? rawId;
  };

  const onFieldIds = new Set([
    toOnFieldPlayerId(innings.strikerId.toString()),
    toOnFieldPlayerId(innings.nonStrikerId.toString())
  ]);
  const unavailablePlayerIds = new Set(
    inningsBatters
      .filter((entry) => entry.playerRef?.playerId)
      .filter((entry) => {
        const playerId = entry.playerRef?.playerId?.toString();
        if (!playerId || onFieldIds.has(playerId)) {
          return false;
        }
        // Exclude batters who are already out or explicitly retired/unavailable in innings state.
        return entry.isOut || entry.outKind === 'retired' || entry.outKind === 'retiredHurt';
      })
      .map((entry) => entry.playerRef?.playerId?.toString())
      .filter((playerId): playerId is string => Boolean(playerId))
  );
  const playerIds = roster.map((entry) => entry.playerId.toString());

  const players = await PlayerModel.find({ _id: { $in: playerIds } }).select({
    _id: 1,
    fullName: 1
  });

  const playerMap = new Map(players.map((player) => [player._id.toString(), player.fullName]));

  const items = roster
    .map((entry) => entry.playerId.toString())
    .filter((playerId) => !onFieldIds.has(playerId))
    .filter((playerId) => !outPlayerIds.has(playerId))
    .filter((playerId) => !unavailablePlayerIds.has(playerId))
    .map((playerId) => ({
      playerId,
      fullName: playerMap.get(playerId) ?? 'Unknown Player'
    }));

  return {
    strikerId: innings.strikerId.toString(),
    nonStrikerId: innings.nonStrikerId.toString(),
    items
  };
};

export const startMatch = async (input: StartMatchInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.matchId, 'Invalid match id.');
  ensureObjectId(input.battingTeamId, 'Invalid batting team id.');
  ensureObjectId(input.bowlingTeamId, 'Invalid bowling team id.');
  ensureObjectId(input.strikerId, 'Invalid striker id.');
  ensureObjectId(input.nonStrikerId, 'Invalid non-striker id.');
  ensureObjectId(input.bowlerId, 'Invalid bowler id.');

  if (input.strikerId === input.nonStrikerId) {
    throw new AppError('Striker and non-striker must be different players.', 400, 'match.batting_pair_invalid');
  }

  const match = await ensureMatch(input.tenantId, input.matchId);
  const tournament = await ensureTournament(input.tenantId, match.tournamentId.toString());

  if (match.status === 'LIVE' && match.currentInningsId) {
    return {
      matchId: match._id.toString(),
      inningsId: match.currentInningsId.toString(),
      status: match.status
    };
  }

  if (match.status !== 'SCHEDULED') {
    throw new AppError('Match is already started or completed.', 409, 'match.invalid_state', {
      matchStatus: match.status,
      currentInningsId: match.currentInningsId?.toString() ?? null
    });
  }

  ensureTeamIdsInMatch(match, input.battingTeamId, input.bowlingTeamId);

  const [battingRoster, bowlingRoster] = await Promise.all([
    scopedFind(MatchPlayerModel, input.tenantId, {
      matchId: input.matchId,
      teamId: input.battingTeamId,
      isPlaying: true
    }),
    scopedFind(MatchPlayerModel, input.tenantId, {
      matchId: input.matchId,
      teamId: input.bowlingTeamId,
      isPlaying: true
    })
  ]);

  if (battingRoster.length === 0 || bowlingRoster.length === 0) {
    throw new AppError('Both teams must have roster before starting match.', 400, 'match.roster_missing');
  }

  const battingIds = new Set(battingRoster.map((entry) => entry.playerId.toString()));
  const bowlingIds = new Set(bowlingRoster.map((entry) => entry.playerId.toString()));

  if (!battingIds.has(input.strikerId) || !battingIds.has(input.nonStrikerId)) {
    throw new AppError('Opening batters must be in batting roster.', 400, 'match.batting_pair_invalid');
  }

  if (!bowlingIds.has(input.bowlerId)) {
    throw new AppError('Bowler must be in bowling roster.', 400, 'match.bowler_invalid');
  }

  const innings = await InningsModel.create({
    tenantId: input.tenantId,
    matchId: input.matchId,
    inningsNumber: 1,
    battingTeamId: input.battingTeamId,
    bowlingTeamId: input.bowlingTeamId,
    strikerId: input.strikerId,
    nonStrikerId: input.nonStrikerId,
    currentBowlerId: input.bowlerId,
    runs: 0,
    wickets: 0,
    balls: 0,
    ballsPerOver: match.ballsPerOver ?? tournament.ballsPerOver ?? 6,
    oversPerInnings: match.oversPerInnings ?? tournament.oversPerInnings,
    eventSeq: 0,
    lastSeq: 0,
    currentOver: {
      overNumber: 0,
      legalBallsInOver: 0,
      balls: []
    },
    status: 'LIVE'
  });

  match.status = 'LIVE';
  match.currentInningsId = innings._id;
  if (tournament.status === 'DRAFT') {
    tournament.status = 'ACTIVE';
    tournament.stageStatus = {
      league:
        tournament.type === 'LEAGUE' || tournament.type === 'LEAGUE_KNOCKOUT'
          ? 'ACTIVE'
          : tournament.stageStatus?.league ?? 'PENDING',
      knockout:
        tournament.type === 'KNOCKOUT'
          ? 'ACTIVE'
          : tournament.stageStatus?.knockout ?? 'PENDING'
    };
    await Promise.all([match.save(), tournament.save()]);
  } else {
    await match.save();
  }

  return {
    matchId: match._id.toString(),
    inningsId: innings._id.toString(),
    status: match.status
  };
};

export const changeCurrentBowler = async (input: ChangeCurrentBowlerInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.matchId, 'Invalid match id.');
  ensureObjectId(input.bowlerId, 'Invalid bowler id.');

  const match = await ensureMatch(input.tenantId, input.matchId);

  if (match.status !== 'LIVE') {
    throw new AppError('Match is not live.', 409, 'match.invalid_state');
  }

  if (!match.currentInningsId) {
    throw new AppError('Match has no active innings.', 409, 'innings.not_started');
  }

  const [innings, tournament] = await Promise.all([
    scopedFindOne(InningsModel, input.tenantId, { _id: match.currentInningsId, matchId: input.matchId, status: 'LIVE' }),
    ensureTournament(input.tenantId, match.tournamentId.toString())
  ]);

  if (!innings) {
    throw new AppError('Innings not found.', 404, 'innings.not_found');
  }

  const currentOver = innings.currentOver as
    | { overNumber?: number; legalBallsInOver?: number; balls?: unknown[] }
    | undefined;

  const legalBallsInOver = currentOver?.legalBallsInOver ?? 0;

  if (legalBallsInOver !== 0) {
    throw new AppError('Current over is not finished.', 409, 'match.over_not_finished');
  }

  const ballsPerOver = innings.ballsPerOver ?? tournament.ballsPerOver ?? 6;
  const oversPerInnings = innings.oversPerInnings ?? tournament.oversPerInnings;
  const completedOvers = Math.floor(innings.balls / ballsPerOver);

  if (completedOvers >= oversPerInnings) {
    throw new AppError('Configured overs are completed.', 409, 'match.overs_completed');
  }

  const bowlerInXI = await scopedFindOne(MatchPlayerModel, input.tenantId, {
    matchId: input.matchId,
    teamId: innings.bowlingTeamId,
    playerId: input.bowlerId,
    isPlaying: true
  });

  if (!bowlerInXI) {
    throw new AppError('Bowler must be in bowling playing XI.', 400, 'match.bowler_invalid');
  }

  innings.currentBowlerId = input.bowlerId as unknown as typeof innings.currentBowlerId;
  await innings.save();

  return {
    matchId: match._id.toString(),
    inningsId: innings._id.toString(),
    bowlerId: innings.currentBowlerId.toString(),
    overNumber: completedOvers
  };
};

export const startSecondInnings = async (input: StartSecondInningsInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.matchId, 'Invalid match id.');
  ensureObjectId(input.strikerId, 'Invalid striker id.');
  ensureObjectId(input.nonStrikerId, 'Invalid non-striker id.');
  ensureObjectId(input.bowlerId, 'Invalid bowler id.');

  if (input.strikerId === input.nonStrikerId) {
    throw new AppError('Striker and non-striker must be different players.', 400, 'match.batting_pair_invalid');
  }

  const match = await ensureMatch(input.tenantId, input.matchId);

  if (match.status !== 'LIVE') {
    throw new AppError('Match is not live.', 409, 'match.invalid_state');
  }

  const [firstInnings, secondInnings, tournament] = await Promise.all([
    scopedFindOne(InningsModel, input.tenantId, {
      matchId: input.matchId,
      inningsNumber: 1
    }),
    scopedFindOne(InningsModel, input.tenantId, {
      matchId: input.matchId,
      inningsNumber: 2
    }),
    ensureTournament(input.tenantId, match.tournamentId.toString())
  ]);

  if (!firstInnings) {
    throw new AppError('First innings not found.', 404, 'innings.not_found');
  }

  if (secondInnings?.status === 'LIVE') {
    return {
      matchId: match._id.toString(),
      inningsId: secondInnings._id.toString(),
      inningsNumber: 2,
      status: match.status
    };
  }

  if (secondInnings) {
    throw new AppError('Second innings already exists.', 409, 'match.invalid_state');
  }

  if (firstInnings.status !== 'COMPLETED') {
    throw new AppError(
      'Cannot start second innings before first innings is completed.',
      409,
      'innings.first_not_completed'
    );
  }

  const secondBattingTeamId = firstInnings.bowlingTeamId.toString();
  const secondBowlingTeamId = firstInnings.battingTeamId.toString();
  const firstInningsRuns = firstInnings.runs;
  const targetRuns = firstInningsRuns + 1;

  const [battingRoster, bowlingRoster] = await Promise.all([
    scopedFind(MatchPlayerModel, input.tenantId, {
      matchId: input.matchId,
      teamId: secondBattingTeamId,
      isPlaying: true
    }),
    scopedFind(MatchPlayerModel, input.tenantId, {
      matchId: input.matchId,
      teamId: secondBowlingTeamId,
      isPlaying: true
    })
  ]);

  if (battingRoster.length === 0 || bowlingRoster.length === 0) {
    throw new AppError('Both teams must have roster before starting innings.', 400, 'match.roster_missing');
  }

  const battingIds = new Set(battingRoster.map((entry) => entry.playerId.toString()));
  const bowlingIds = new Set(bowlingRoster.map((entry) => entry.playerId.toString()));

  if (!battingIds.has(input.strikerId) || !battingIds.has(input.nonStrikerId)) {
    throw new AppError('Opening batters must be in batting roster.', 400, 'match.batting_pair_invalid');
  }

  if (!bowlingIds.has(input.bowlerId)) {
    throw new AppError('Bowler must be in bowling roster.', 400, 'match.bowler_invalid');
  }

  const innings = await InningsModel.create({
    tenantId: input.tenantId,
    matchId: input.matchId,
    inningsNumber: 2,
    battingTeamId: secondBattingTeamId,
    bowlingTeamId: secondBowlingTeamId,
    strikerId: input.strikerId,
    nonStrikerId: input.nonStrikerId,
    currentBowlerId: input.bowlerId,
    runs: 0,
    wickets: 0,
    balls: 0,
    ballsPerOver: match.ballsPerOver ?? tournament.ballsPerOver ?? 6,
    oversPerInnings: match.oversPerInnings ?? tournament.oversPerInnings,
    eventSeq: 0,
    lastSeq: 0,
    currentOver: {
      overNumber: 0,
      legalBallsInOver: 0,
      balls: []
    },
    status: 'LIVE'
  });

  match.firstInningsRuns = firstInningsRuns;
  match.secondInningsTarget = targetRuns;
  match.result = {
    isNoResult: match.result?.isNoResult ?? false,
    ...(match.result ?? {}),
    targetRuns
  };
  match.currentInningsId = innings._id;
  await match.save();

  return {
    matchId: match._id.toString(),
    inningsId: innings._id.toString(),
    inningsNumber: 2,
    status: match.status
  };
};

export const getMatchScore = async (tenantId: string, matchId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(matchId, 'Invalid match id.');

  const match = await ensureMatch(tenantId, matchId);

  if (match.status === 'SCHEDULED') {
    throw new AppError('Match is not live.', 409, 'match.invalid_state', {
      matchStatus: match.status,
      currentInningsId: match.currentInningsId?.toString() ?? null
    });
  }

  const tournament = await ensureTournament(tenantId, match.tournamentId.toString());

  let innings = match.currentInningsId
    ? await scopedFindOne(InningsModel, tenantId, { _id: match.currentInningsId, matchId })
    : null;

  // Fallback for temporary linkage mismatch: resolve the active innings by match.
  if (!innings) {
    innings = await scopedFind(InningsModel, tenantId, {
      matchId,
      status: { $in: ['LIVE', 'COMPLETED'] }
    })
      .sort({ inningsNumber: -1, createdAt: -1 })
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  if (!innings) {
    throw new AppError('Innings is not ready yet.', 409, 'match.starting_in_progress', {
      matchStatus: match.status,
      currentInningsId: match.currentInningsId?.toString() ?? null,
      inningsExists: false,
      retryAfterMs: 500
    });
  }

  // Best-effort self-heal if match lost current innings pointer.
  if (!match.currentInningsId) {
    match.currentInningsId = innings._id;
    await match.save();
  }

  const ballsPerOver = innings.ballsPerOver ?? tournament.ballsPerOver ?? 6;
  const oversPerInnings = innings.oversPerInnings ?? tournament.oversPerInnings;

  const [battingTeam, bowlingTeam, lastEvent, strikerBatterId, nonStrikerBatterId] = await Promise.all([
    scopedFindOne(TeamModel, tenantId, { _id: innings.battingTeamId }),
    scopedFindOne(TeamModel, tenantId, { _id: innings.bowlingTeamId }),
    ScoreEventModel.findOne({
      tenantId,
      matchId,
      inningsId: innings._id,
      isUndone: false
    }).sort({ seq: -1 }),
    resolveCurrentBatterId(tenantId, innings._id.toString(), innings.strikerId.toString()),
    resolveCurrentBatterId(tenantId, innings._id.toString(), innings.nonStrikerId.toString())
  ]);

  if (!battingTeam || !bowlingTeam) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }

  let chase:
    | {
        targetRuns: number;
        runsRemaining: number;
        maxLegalBalls: number;
        target: number;
        firstInningsRuns: number;
        runsNeeded: number;
        ballsRemaining: number;
        requiredRunRate: number | null;
      }
    | null = null;

  if (innings.inningsNumber === 2) {
    const firstInnings = await scopedFindOne(InningsModel, tenantId, {
      matchId,
      inningsNumber: 1
    });

    if (!firstInnings) {
      throw new AppError('First innings not found.', 404, 'innings.not_found');
    }

    const targetRuns = match.secondInningsTarget ?? firstInnings.runs + 1;
    const maxBalls = oversPerInnings * ballsPerOver;
    const ballsRemaining = Math.max(0, maxBalls - innings.balls);
    const runsNeeded = Math.max(0, targetRuns - innings.runs);
    const requiredRunRate =
      ballsRemaining > 0 ? Number((runsNeeded / (ballsRemaining / ballsPerOver)).toFixed(2)) : null;

    chase = {
      targetRuns,
      runsRemaining: runsNeeded,
      maxLegalBalls: maxBalls,
      target: targetRuns,
      firstInningsRuns: firstInnings.runs,
      runsNeeded,
      ballsRemaining,
      requiredRunRate
    };
  }

  const result = match.result
    ? {
        type: match.result.type ?? (match.result.isNoResult ? 'NO_RESULT' : undefined),
        winnerTeamId: match.result.winnerTeamId?.toString() ?? null,
        winByRuns: match.result.winByRuns ?? null,
        winByWickets: match.result.winByWickets ?? match.result.winByWkts ?? null,
        targetRuns: match.result.targetRuns ?? match.secondInningsTarget ?? null
      }
    : null;

  const scoredEvents = await ScoreEventModel.find({
    tenantId,
    matchId,
    inningsId: innings._id,
    type: { $in: ['extra', 'wicket'] },
    $and: [
      { $or: [{ isUndone: false }, { isUndone: { $exists: false } }] },
      { $or: [{ undoneAt: null }, { undoneAt: { $exists: false } }] }
    ]
  }).select({ payload: 1, type: 1 });

  let wides = 0;
  let noBalls = 0;
  let byes = 0;
  let legByes = 0;

  scoredEvents.forEach((event) => {
    const payload = event.payload as
      | { extraType?: string; additionalRuns?: unknown; runsWithWicket?: unknown }
      | undefined;
    const eventType = event.type;

    if (eventType === 'extra') {
      const extraType = payload?.extraType;
      const additionalRunsRaw = payload?.additionalRuns;
      const additionalRuns = typeof additionalRunsRaw === 'number' ? additionalRunsRaw : 0;

      if (extraType === 'wide') {
        wides += 1 + additionalRuns;
      } else if (extraType === 'noBall') {
        noBalls += 1;
      } else if (extraType === 'byes') {
        byes += additionalRuns;
      } else if (extraType === 'legByes') {
        legByes += additionalRuns;
      }
      return;
    }

    if (eventType === 'wicket') {
      const extraType = payload?.extraType;
      const runsWithWicketRaw = payload?.runsWithWicket;
      const runsWithWicket = typeof runsWithWicketRaw === 'number' ? runsWithWicketRaw : 0;

      if (extraType === 'wide') {
        wides += 1 + runsWithWicket;
      } else if (extraType === 'noBall') {
        noBalls += 1 + runsWithWicket;
      }
    }
  });

  const extras = wides + noBalls + byes + legByes;

  return {
    matchId: match._id.toString(),
    inningsId: innings._id.toString(),
    inningsNumber: innings.inningsNumber,
    battingTeam: {
      id: battingTeam._id.toString(),
      name: battingTeam.name,
      shortName: battingTeam.shortName
    },
    bowlingTeam: {
      id: bowlingTeam._id.toString(),
      name: bowlingTeam.name,
      shortName: bowlingTeam.shortName
    },
    score: {
      runs: innings.runs,
      wickets: innings.wickets,
      balls: innings.balls,
      overs: formatOvers(innings.balls, ballsPerOver),
      extras,
      wides,
      noBalls,
      byes,
      legByes
    },
    current: {
      strikerId: strikerBatterId,
      nonStrikerId: nonStrikerBatterId,
      bowlerId: innings.currentBowlerId.toString()
    },
    lastEvent: lastEvent
      ? {
          id: lastEvent._id.toString(),
          seq: lastEvent.seq,
          type: lastEvent.type
        }
      : null,
    settings: {
      ballsPerOver,
      oversPerInnings
    },
    chase,
    isChase: innings.inningsNumber === 2,
    isMatchCompleted: match.status === 'COMPLETED',
    result
  };
};

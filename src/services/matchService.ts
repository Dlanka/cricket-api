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
import { syncKnockoutProgression } from './tournamentService';
import {
  getCachedMatchScore,
  invalidateCachedMatchScore,
  setCachedMatchScore
} from './utils/matchScoreCache';
import { emitMatchScoreRefresh } from './utils/matchScoreRealtime';

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

const isLegalDeliveryEvent = (event: { type: string; isLegal?: boolean; payload?: Record<string, unknown> }) => {
  if (typeof event.isLegal === 'boolean') {
    return event.isLegal;
  }

  if (event.type === 'run' || event.type === 'wicket') {
    return true;
  }

  if (event.type !== 'extra') {
    return false;
  }

  const extraType = event.payload?.extraType as string | undefined;
  return extraType === 'byes' || extraType === 'legByes';
};

const getCompletedRunsForDelivery = (event: { type: string; payload?: Record<string, unknown> }) => {
  const payload = event.payload ?? {};

  if (event.type === 'run') {
    return Number(payload.runs ?? 0);
  }

  if (event.type === 'extra') {
    return Number(payload.additionalRuns ?? 0);
  }

  if (event.type === 'wicket') {
    return Number(payload.runsWithWicket ?? 0);
  }

  return 0;
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
          resultType: match.result?.type ?? (match.result?.isNoResult ? 'NO_RESULT' : null),
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
          type: entry.result?.type ?? (entry.result?.isNoResult ? 'NO_RESULT' : null),
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
  const superOverInnings = await scopedFind(InningsModel, tenantId, {
    matchId,
    inningsNumber: { $in: [3, 4] }
  });

  if (!teamA) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }

  if (match.teamBId && !teamB) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }

  const superOverInnings3 = superOverInnings.find((entry) => entry.inningsNumber === 3);
  const superOverInnings4 = superOverInnings.find((entry) => entry.inningsNumber === 4);
  const teamARuns =
    (superOverInnings3?.battingTeamId.toString() === teamA._id.toString()
      ? superOverInnings3.runs
      : superOverInnings4?.battingTeamId.toString() === teamA._id.toString()
        ? superOverInnings4.runs
        : 0) ?? 0;
  const teamBRuns =
    (teamB &&
    (superOverInnings3?.battingTeamId.toString() === teamB._id.toString()
      ? superOverInnings3.runs
      : superOverInnings4?.battingTeamId.toString() === teamB._id.toString()
        ? superOverInnings4.runs
        : 0)) ?? 0;

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
    toss: match.toss
      ? {
          wonByTeamId: match.toss.wonByTeamId.toString(),
          decision: match.toss.decision
        }
      : null,
    phase: match.phase ?? 'REGULAR',
    hasSuperOver: match.hasSuperOver ?? false,
    superOverStatus: match.superOverStatus ?? null,
    superOver: {
      teamARuns,
      teamBRuns,
      winnerTeamId: match.superOverWinnerTeamId?.toString() ?? null,
      isTie: match.superOverTie ?? false
    },
    currentInningsId: match.currentInningsId?.toString()
  };
};

export const setMatchToss = async (input: SetMatchTossInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.matchId, 'Invalid match id.');
  ensureObjectId(input.wonByTeamId, 'Invalid toss winner team id.');

  const match = await ensureMatch(input.tenantId, input.matchId);

  if (match.status !== 'SCHEDULED') {
    throw new AppError('Toss can only be set before match starts.', 409, 'match.invalid_state');
  }

  const teamAId = match.teamAId.toString();
  const teamBId = match.teamBId?.toString();

  if (!teamBId) {
    throw new AppError('Match requires two teams for toss.', 400, 'match.invalid_teams');
  }

  if (input.wonByTeamId !== teamAId && input.wonByTeamId !== teamBId) {
    throw new AppError('Toss winner team is invalid for this match.', 400, 'match.team_invalid');
  }

  match.toss = {
    wonByTeamId: input.wonByTeamId as unknown as typeof match.teamAId,
    decision: input.decision
  };
  await match.save();

  return {
    matchId: match._id.toString(),
    status: match.status,
    toss: {
      wonByTeamId: match.toss.wonByTeamId.toString(),
      decision: match.toss.decision
    }
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
  invalidateCachedMatchScore(input.tenantId, input.matchId);
  emitMatchScoreRefresh(input.tenantId, input.matchId);

  return {
    matchId: match._id.toString(),
    oversPerInnings: match.oversPerInnings,
    ballsPerOver: match.ballsPerOver,
    status: match.status
  };
};

export const resolveMatchTie = async (input: ResolveMatchTieInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.matchId, 'Invalid match id.');
  ensureObjectId(input.winnerTeamId, 'Invalid winner team id.');

  const match = await ensureMatch(input.tenantId, input.matchId);

  if (!isKnockoutStage(match.stage)) {
    throw new AppError(
      'Tie-break winner can be set only for knockout matches.',
      409,
      'match.tie_break_not_applicable'
    );
  }

  if (match.status !== 'COMPLETED') {
    throw new AppError('Match must be completed before setting tie-break winner.', 409, 'match.invalid_state');
  }

  if (match.superOverStatus === 'PENDING' || match.superOverStatus === 'LIVE') {
    throw new AppError('Super over is pending for this match.', 409, 'match.super_over_pending');
  }

  if (match.result?.type !== 'TIE') {
    throw new AppError('Tie-break winner can be set only for tied matches.', 409, 'match.tie_break_not_allowed');
  }

  if (match.hasSuperOver && match.superOverStatus === 'COMPLETED' && !match.superOverTie) {
    throw new AppError('Tie-break winner is not allowed once super over is resolved.', 409, 'match.tie_break_not_allowed');
  }

  const teamAId = match.teamAId.toString();
  const teamBId = match.teamBId?.toString() ?? null;
  if (!teamBId || (input.winnerTeamId !== teamAId && input.winnerTeamId !== teamBId)) {
    throw new AppError('Winner team is invalid for this match.', 400, 'match.team_invalid');
  }

  match.result = {
    ...(match.result ?? {}),
    type: 'WIN',
    winnerTeamId: input.winnerTeamId as unknown as typeof match.teamAId,
    winByRuns: undefined,
    winByWickets: undefined,
    winByWkts: undefined,
    isNoResult: false
  };
  match.superOverWinnerTeamId = input.winnerTeamId as unknown as typeof match.teamAId;
  if (match.hasSuperOver) {
    match.superOverTie = false;
    match.superOverStatus = 'COMPLETED';
  }
  await match.save();
  invalidateCachedMatchScore(input.tenantId, input.matchId);
  emitMatchScoreRefresh(input.tenantId, input.matchId);

  const progression = await syncKnockoutProgression(
    input.tenantId,
    match.tournamentId.toString(),
    match._id.toString()
  );

  return {
    matchId: match._id.toString(),
    tournamentId: match.tournamentId.toString(),
    result: {
      type: match.result.type,
      winnerTeamId: match.result.winnerTeamId?.toString() ?? null
    },
    progression
  };
};

export const generateFixtures = async (
  tenantId: string,
  tournamentId: string,
  options?: { regenerate?: boolean }
) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(tournamentId, 'Invalid tournament id.');

  const tournament = await ensureTournament(tenantId, tournamentId);

  const existingMatches = await scopedFind(MatchModel, tenantId, { tournamentId }).select({
    _id: 1,
    status: 1,
    teamBId: 1
  });

  if (existingMatches.length > 0) {
    if (!options?.regenerate) {
      throw new AppError('Matches already exist for this tournament.', 409, 'match.already_exists', {
        canRegenerate: true
      });
    }

    const startedMatch = existingMatches.find(
      (entry) =>
        entry.status === 'LIVE' || (entry.status === 'COMPLETED' && entry.teamBId !== null)
    );
    if (startedMatch) {
      throw new AppError(
        'Fixtures cannot be regenerated after a match has started.',
        409,
        'match.regenerate_blocked'
      );
    }

    const existingMatchIds = existingMatches.map((entry) => entry._id);
    const [inningsExists, scoreEventExists] = await Promise.all([
      InningsModel.exists({ tenantId, matchId: { $in: existingMatchIds } }),
      ScoreEventModel.exists({ tenantId, matchId: { $in: existingMatchIds } })
    ]);

    if (inningsExists || scoreEventExists) {
      throw new AppError(
        'Fixtures cannot be regenerated because score data already exists.',
        409,
        'match.regenerate_blocked'
      );
    }

    await Promise.all([
      MatchPlayerModel.deleteMany({ tenantId, matchId: { $in: existingMatchIds } }),
      MatchModel.deleteMany({ tenantId, _id: { $in: existingMatchIds } })
    ]);
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

export type SetMatchTossInput = {
  tenantId: string;
  matchId: string;
  wonByTeamId: string;
  decision: 'BAT' | 'BOWL';
};

export type UpdateMatchConfigInput = {
  tenantId: string;
  matchId: string;
  oversPerInnings?: number;
  ballsPerOver?: number;
};

export type ResolveMatchTieInput = {
  tenantId: string;
  matchId: string;
  winnerTeamId: string;
};

export type StartSuperOverInput = {
  tenantId: string;
  matchId: string;
  teamA: {
    battingFirst: boolean;
    strikerId: string;
    nonStrikerId: string;
    bowlerId: string;
  };
  teamB: {
    strikerId: string;
    nonStrikerId: string;
    bowlerId: string;
  };
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
    matchId
  });

  if (!innings) {
    throw new AppError('Innings not found.', 404, 'innings.not_found');
  }

  if (innings.status !== 'LIVE') {
    return {
      strikerId: innings.strikerId.toString(),
      nonStrikerId: innings.nonStrikerId.toString(),
      items: []
    };
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
  invalidateCachedMatchScore(input.tenantId, input.matchId);
  emitMatchScoreRefresh(input.tenantId, input.matchId);

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

  const ballsPerOver = innings.ballsPerOver ?? tournament.ballsPerOver ?? 6;
  const legalBallsInOver =
    typeof currentOver?.legalBallsInOver === 'number' &&
    Number.isFinite(currentOver.legalBallsInOver)
      ? currentOver.legalBallsInOver
      : innings.balls % ballsPerOver;

  if (legalBallsInOver !== 0) {
    throw new AppError('Current over is not finished.', 409, 'match.over_not_finished');
  }

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

  const isOverBoundary = innings.balls > 0 && innings.balls % ballsPerOver === 0;
  if (isOverBoundary) {
    const recentScoringEvents = await ScoreEventModel.find({
      tenantId: input.tenantId,
      inningsId: innings._id,
      type: { $in: ['run', 'extra', 'wicket'] },
      $and: [
        { $or: [{ isUndone: false }, { isUndone: { $exists: false } }] },
        { $or: [{ undoneAt: null }, { undoneAt: { $exists: false } }] }
      ]
    })
      .sort({ seq: -1 })
      .limit(12)
      .select({ type: 1, isLegal: 1, payload: 1, beforeSnapshot: 1 });

    const lastLegalDelivery = recentScoringEvents.find((event) =>
      isLegalDeliveryEvent({
        type: event.type,
        isLegal: event.isLegal,
        payload: event.payload as Record<string, unknown> | undefined
      })
    );

    const beforeInnings =
      (lastLegalDelivery?.beforeSnapshot as { innings?: { strikerId?: unknown; nonStrikerId?: unknown } })
        ?.innings ?? null;
    const beforeStrikerId =
      beforeInnings?.strikerId != null ? String(beforeInnings.strikerId) : null;
    const beforeNonStrikerId =
      beforeInnings?.nonStrikerId != null ? String(beforeInnings.nonStrikerId) : null;

    if (lastLegalDelivery && beforeStrikerId && beforeNonStrikerId) {
      const completedRuns = getCompletedRunsForDelivery({
        type: lastLegalDelivery.type,
        payload: lastLegalDelivery.payload as Record<string, unknown> | undefined
      });

      const postBallPair =
        completedRuns % 2 === 1
          ? { strikerId: beforeNonStrikerId, nonStrikerId: beforeStrikerId }
          : { strikerId: beforeStrikerId, nonStrikerId: beforeNonStrikerId };

      // New over striker must be validated from the last legal delivery.
      const expectedNextOverPair = {
        strikerId: postBallPair.nonStrikerId,
        nonStrikerId: postBallPair.strikerId
      };

      const currentStrikerId = innings.strikerId.toString();
      const currentNonStrikerId = innings.nonStrikerId.toString();
      if (
        currentStrikerId !== expectedNextOverPair.strikerId ||
        currentNonStrikerId !== expectedNextOverPair.nonStrikerId
      ) {
        innings.strikerId = expectedNextOverPair.strikerId as unknown as typeof innings.strikerId;
        innings.nonStrikerId =
          expectedNextOverPair.nonStrikerId as unknown as typeof innings.nonStrikerId;
      }
    }
  }

  innings.currentBowlerId = input.bowlerId as unknown as typeof innings.currentBowlerId;
  await innings.save();
  invalidateCachedMatchScore(input.tenantId, input.matchId);
  emitMatchScoreRefresh(input.tenantId, input.matchId);

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
  invalidateCachedMatchScore(input.tenantId, input.matchId);
  emitMatchScoreRefresh(input.tenantId, input.matchId);

  return {
    matchId: match._id.toString(),
    inningsId: innings._id.toString(),
    inningsNumber: 2,
    status: match.status
  };
};

export const startSuperOver = async (input: StartSuperOverInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.matchId, 'Invalid match id.');
  ensureObjectId(input.teamA.strikerId, 'Invalid striker id.');
  ensureObjectId(input.teamA.nonStrikerId, 'Invalid non-striker id.');
  ensureObjectId(input.teamA.bowlerId, 'Invalid bowler id.');
  ensureObjectId(input.teamB.strikerId, 'Invalid striker id.');
  ensureObjectId(input.teamB.nonStrikerId, 'Invalid non-striker id.');
  ensureObjectId(input.teamB.bowlerId, 'Invalid bowler id.');

  if (input.teamA.strikerId === input.teamA.nonStrikerId) {
    throw new AppError('Team A striker and non-striker must be different.', 400, 'match.batting_pair_invalid');
  }
  if (input.teamB.strikerId === input.teamB.nonStrikerId) {
    throw new AppError('Team B striker and non-striker must be different.', 400, 'match.batting_pair_invalid');
  }

  const match = await ensureMatch(input.tenantId, input.matchId);
  if (!isKnockoutStage(match.stage)) {
    throw new AppError('Super over is allowed only for knockout matches.', 409, 'match.super_over_not_applicable');
  }

  if (match.result?.type !== 'TIE') {
    throw new AppError('Super over can start only after a tied result.', 409, 'match.super_over_invalid_state');
  }

  if (match.superOverStatus === 'LIVE' || match.superOverStatus === 'COMPLETED') {
    throw new AppError('Super over is already started for this match.', 409, 'match.super_over_already_started');
  }

  const teamAId = match.teamAId.toString();
  const teamBId = match.teamBId?.toString();
  if (!teamBId) {
    throw new AppError('Match requires two teams for super over.', 400, 'match.invalid_teams');
  }

  const firstInnings = await scopedFindOne(InningsModel, input.tenantId, {
    matchId: input.matchId,
    inningsNumber: 1
  });
  if (!firstInnings) {
    throw new AppError('Cannot derive super over order without first innings.', 409, 'match.super_over_invalid_state');
  }

  const requiredBattingFirstTeamId = firstInnings.bowlingTeamId.toString();
  const selectedBattingFirstTeamId = input.teamA.battingFirst ? teamAId : teamBId;
  if (selectedBattingFirstTeamId !== requiredBattingFirstTeamId) {
    throw new AppError(
      'Super over batting order is invalid. Team batting second in the match must bat first.',
      409,
      'match.super_over_invalid_state'
    );
  }

  const battingFirstTeamId = requiredBattingFirstTeamId;
  const bowlingFirstTeamId = battingFirstTeamId === teamAId ? teamBId : teamAId;
  const battingFirstConfig = battingFirstTeamId === teamAId ? input.teamA : input.teamB;
  const battingSecondConfig = battingFirstTeamId === teamAId ? input.teamB : input.teamA;

  const [teamARoster, teamBRoster, tournament] = await Promise.all([
    scopedFind(MatchPlayerModel, input.tenantId, { matchId: input.matchId, teamId: teamAId, isPlaying: true }),
    scopedFind(MatchPlayerModel, input.tenantId, { matchId: input.matchId, teamId: teamBId, isPlaying: true }),
    ensureTournament(input.tenantId, match.tournamentId.toString())
  ]);

  const teamAPlayers = new Set(teamARoster.map((entry) => entry.playerId.toString()));
  const teamBPlayers = new Set(teamBRoster.map((entry) => entry.playerId.toString()));

  const assertPlayer = (teamId: string, playerId: string, code: 'match.batting_pair_invalid' | 'match.bowler_invalid') => {
    const roster = teamId === teamAId ? teamAPlayers : teamBPlayers;
    if (!roster.has(playerId)) {
      throw new AppError('Super over player must be from playing XI.', 400, code);
    }
  };

  assertPlayer(battingFirstTeamId, battingFirstConfig.strikerId, 'match.batting_pair_invalid');
  assertPlayer(battingFirstTeamId, battingFirstConfig.nonStrikerId, 'match.batting_pair_invalid');
  assertPlayer(bowlingFirstTeamId, battingFirstConfig.bowlerId, 'match.bowler_invalid');
  assertPlayer(bowlingFirstTeamId, battingSecondConfig.strikerId, 'match.batting_pair_invalid');
  assertPlayer(bowlingFirstTeamId, battingSecondConfig.nonStrikerId, 'match.batting_pair_invalid');
  assertPlayer(battingFirstTeamId, battingSecondConfig.bowlerId, 'match.bowler_invalid');

  const superOverInnings1 = await InningsModel.create({
    tenantId: input.tenantId,
    matchId: input.matchId,
    inningsNumber: 3,
    battingTeamId: battingFirstTeamId,
    bowlingTeamId: bowlingFirstTeamId,
    strikerId: battingFirstConfig.strikerId,
    nonStrikerId: battingFirstConfig.nonStrikerId,
    currentBowlerId: battingFirstConfig.bowlerId,
    runs: 0,
    wickets: 0,
    balls: 0,
    ballsPerOver: match.ballsPerOver ?? tournament.ballsPerOver ?? 6,
    oversPerInnings: 1,
    eventSeq: 0,
    lastSeq: 0,
    currentOver: {
      overNumber: 0,
      legalBallsInOver: 0,
      balls: []
    },
    status: 'LIVE'
  });

  match.phase = 'SUPER_OVER';
  match.hasSuperOver = true;
  match.superOverStatus = 'LIVE';
  match.superOverWinnerTeamId = undefined;
  match.superOverTie = false;
  match.superOverSetup = {
    battingFirstTeamId,
    bowlingFirstTeamId,
    teamA: input.teamA,
    teamB: input.teamB
  } as unknown as typeof match.superOverSetup;
  match.status = 'LIVE';
  match.currentInningsId = superOverInnings1._id;
  await match.save();
  invalidateCachedMatchScore(input.tenantId, input.matchId);
  emitMatchScoreRefresh(input.tenantId, input.matchId);

  return {
    matchId: match._id.toString(),
    inningsId: superOverInnings1._id.toString(),
    inningsNumber: 3,
    phase: match.phase,
    superOverStatus: match.superOverStatus
  };
};

export const getMatchScore = async (
  tenantId: string,
  matchId: string
): Promise<Record<string, unknown>> => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(matchId, 'Invalid match id.');

  const cached = getCachedMatchScore<Record<string, unknown>>(tenantId, matchId);
  if (cached) {
    return cached;
  }

  const match = await ensureMatch(tenantId, matchId);

  if (match.status === 'SCHEDULED') {
    throw new AppError('Match is not live.', 409, 'match.invalid_state', {
      matchStatus: match.status,
      currentInningsId: match.currentInningsId?.toString() ?? null
    });
  }

  let innings = match.currentInningsId
    ? await scopedFindOne(InningsModel, tenantId, { _id: match.currentInningsId, matchId })
    : null;

  // For completed matches, always resolve to the final completed innings context.
  // This avoids showing stale/reset snapshots when currentInningsId is cleared.
  if (match.status === 'COMPLETED') {
    const completedInnings = await scopedFind(InningsModel, tenantId, {
      matchId,
      status: 'COMPLETED'
    }).sort({ inningsNumber: -1, createdAt: -1 });

    if (completedInnings.length > 0) {
      if (match.phase === 'SUPER_OVER') {
        innings =
          completedInnings.find((entry) => entry.inningsNumber === 4) ??
          completedInnings.find((entry) => entry.inningsNumber === 3) ??
          completedInnings[0];
      } else {
        innings =
          completedInnings.find((entry) => entry.inningsNumber === 2) ??
          completedInnings.find((entry) => entry.inningsNumber === 1) ??
          completedInnings[0];
      }
    }
  }

  // Prefer a LIVE innings if the current pointer is stale (for example, still on innings 1 after innings 2 start).
  const liveInnings =
    match.status === 'COMPLETED'
      ? null
      : await scopedFindOne(InningsModel, tenantId, {
          matchId,
          status: 'LIVE'
        }).sort({ inningsNumber: -1, createdAt: -1 });

  if (
    liveInnings &&
    (!innings || innings.status !== 'LIVE' || innings._id.toString() !== liveInnings._id.toString())
  ) {
    innings = liveInnings;
    if (!match.currentInningsId || match.currentInningsId.toString() !== liveInnings._id.toString()) {
      match.currentInningsId = liveInnings._id;
      await match.save();
    }
  }

  // Fallback for temporary linkage mismatch: resolve the most recent innings by match.
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

  const ballsPerOver = innings.ballsPerOver ?? match.ballsPerOver ?? 6;
  const oversPerInnings = innings.oversPerInnings ?? match.oversPerInnings ?? 1;
  const onFieldIds = [innings.strikerId.toString(), innings.nonStrikerId.toString()];

  const [battingTeam, bowlingTeam, lastEvent, onFieldBatters] = await Promise.all([
    scopedFindOne(TeamModel, tenantId, { _id: innings.battingTeamId }),
    scopedFindOne(TeamModel, tenantId, { _id: innings.bowlingTeamId }),
    ScoreEventModel.findOne({
      tenantId,
      matchId,
      inningsId: innings._id,
      isUndone: false
    })
      .sort({ seq: -1 })
      .select({ _id: 1, seq: 1, type: 1 }),
    scopedFind(InningsBatterModel, tenantId, {
      inningsId: innings._id,
      $or: [
        { _id: { $in: onFieldIds } },
        { 'playerRef.playerId': { $in: onFieldIds } },
        { 'batterKey.playerId': { $in: onFieldIds } }
      ]
    }).select({ _id: 1, playerRef: 1, batterKey: 1 })
  ]);

  if (!battingTeam || !bowlingTeam) {
    throw new AppError('Team not found.', 404, 'team.not_found');
  }

  const onFieldPlayerToBatter = new Map<string, string>();
  const onFieldBatterIds = new Set<string>();
  onFieldBatters.forEach((entry) => {
    const batterId = entry._id.toString();
    onFieldBatterIds.add(batterId);
    const playerRefId = entry.playerRef?.playerId?.toString();
    if (playerRefId) {
      onFieldPlayerToBatter.set(playerRefId, batterId);
    }
    const batterKeyPlayerId = entry.batterKey?.playerId?.toString();
    if (batterKeyPlayerId) {
      onFieldPlayerToBatter.set(batterKeyPlayerId, batterId);
    }
  });

  const resolveOnFieldBatterId = (rawId: string) => {
    if (onFieldBatterIds.has(rawId)) {
      return rawId;
    }
    return onFieldPlayerToBatter.get(rawId) ?? rawId;
  };

  const strikerBatterId = resolveOnFieldBatterId(innings.strikerId.toString());
  const nonStrikerBatterId = resolveOnFieldBatterId(innings.nonStrikerId.toString());

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
  let superOverChase:
    | {
        targetRuns: number;
        firstInningsRuns: number;
        runsRemaining: number;
        ballsRemaining: number;
        requiredRunRate: number | null;
      }
    | null = null;

  if (innings.inningsNumber === 2) {
    let firstInningsRuns = match.firstInningsRuns;
    if (typeof firstInningsRuns !== 'number') {
      const firstInnings = await scopedFindOne(InningsModel, tenantId, {
        matchId,
        inningsNumber: 1
      }).select({ runs: 1 });
      if (!firstInnings) {
        throw new AppError('First innings not found.', 404, 'innings.not_found');
      }
      firstInningsRuns = firstInnings.runs;
    }

    const targetRuns = match.secondInningsTarget ?? firstInningsRuns + 1;
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
      firstInningsRuns,
      runsNeeded,
      ballsRemaining,
      requiredRunRate
    };
  }

  if (match.phase === 'SUPER_OVER' && innings.inningsNumber === 4) {
    const superOverFirstInnings = await scopedFindOne(InningsModel, tenantId, {
      matchId,
      inningsNumber: 3
    });

    if (superOverFirstInnings) {
      const targetRuns = superOverFirstInnings.runs + 1;
      const maxBalls = ballsPerOver;
      const ballsRemaining = Math.max(0, maxBalls - innings.balls);
      const runsRemaining = Math.max(0, targetRuns - innings.runs);
      const requiredRunRate =
        ballsRemaining > 0 ? Number((runsRemaining / (ballsRemaining / ballsPerOver)).toFixed(2)) : null;

      superOverChase = {
        targetRuns,
        firstInningsRuns: superOverFirstInnings.runs,
        runsRemaining,
        ballsRemaining,
        requiredRunRate
      };
    }
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

  let teamARuns = 0;
  let teamBRuns = 0;
  if (match.phase === 'SUPER_OVER' || match.hasSuperOver || match.superOverStatus) {
    const superOverInnings = await scopedFind(InningsModel, tenantId, {
      matchId,
      inningsNumber: { $in: [3, 4] }
    }).select({ inningsNumber: 1, battingTeamId: 1, runs: 1 });
    const superOverInnings3 = superOverInnings.find((entry) => entry.inningsNumber === 3);
    const superOverInnings4 = superOverInnings.find((entry) => entry.inningsNumber === 4);
    const resolveSuperOverRuns = (teamId: string | null) => {
      if (!teamId) return 0;
      if (superOverInnings3 && superOverInnings3.battingTeamId.toString() === teamId) {
        return superOverInnings3.runs;
      }
      if (superOverInnings4 && superOverInnings4.battingTeamId.toString() === teamId) {
        return superOverInnings4.runs;
      }
      return 0;
    };
    teamARuns = resolveSuperOverRuns(match.teamAId.toString());
    teamBRuns = resolveSuperOverRuns(match.teamBId?.toString() ?? null);
  }

  let wides =
    typeof (innings as { wides?: unknown }).wides === 'number'
      ? ((innings as { wides: number }).wides ?? 0)
      : null;
  let noBalls =
    typeof (innings as { noBalls?: unknown }).noBalls === 'number'
      ? ((innings as { noBalls: number }).noBalls ?? 0)
      : null;
  let byes =
    typeof (innings as { byes?: unknown }).byes === 'number'
      ? ((innings as { byes: number }).byes ?? 0)
      : null;
  let legByes =
    typeof (innings as { legByes?: unknown }).legByes === 'number'
      ? ((innings as { legByes: number }).legByes ?? 0)
      : null;
  let extras =
    typeof (innings as { extras?: unknown }).extras === 'number'
      ? ((innings as { extras: number }).extras ?? 0)
      : null;

  // Backward compatibility for old innings documents that were created before extras counters.
  if (wides === null || noBalls === null || byes === null || legByes === null || extras === null) {
    const scoredEvents = await ScoreEventModel.find({
      tenantId,
      matchId,
      inningsId: innings._id,
      type: { $in: ['extra', 'wicket'] },
      isUndone: false
    }).select({ payload: 1, type: 1 });

    let calculatedWides = 0;
    let calculatedNoBalls = 0;
    let calculatedByes = 0;
    let calculatedLegByes = 0;

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
          calculatedWides += 1 + additionalRuns;
        } else if (extraType === 'noBall') {
          calculatedNoBalls += 1;
        } else if (extraType === 'byes') {
          calculatedByes += additionalRuns;
        } else if (extraType === 'legByes') {
          calculatedLegByes += additionalRuns;
        }
        return;
      }

      if (eventType === 'wicket') {
        const extraType = payload?.extraType;
        const runsWithWicketRaw = payload?.runsWithWicket;
        const runsWithWicket = typeof runsWithWicketRaw === 'number' ? runsWithWicketRaw : 0;

        if (extraType === 'wide') {
          calculatedWides += 1 + runsWithWicket;
        } else if (extraType === 'noBall') {
          calculatedNoBalls += 1 + runsWithWicket;
        }
      }
    });

    wides = calculatedWides;
    noBalls = calculatedNoBalls;
    byes = calculatedByes;
    legByes = calculatedLegByes;
    extras = calculatedWides + calculatedNoBalls + calculatedByes + calculatedLegByes;

    (innings as { wides?: number }).wides = wides;
    (innings as { noBalls?: number }).noBalls = noBalls;
    (innings as { byes?: number }).byes = byes;
    (innings as { legByes?: number }).legByes = legByes;
    (innings as { extras?: number }).extras = extras;
    await innings.save();
  }

  const response = {
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
      extras: extras ?? 0,
      wides: wides ?? 0,
      noBalls: noBalls ?? 0,
      byes: byes ?? 0,
      legByes: legByes ?? 0
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
    phase: match.phase ?? 'REGULAR',
    hasSuperOver: match.hasSuperOver ?? false,
    superOverStatus: match.superOverStatus ?? null,
    superOver: {
      teamARuns,
      teamBRuns,
      winnerTeamId: match.superOverWinnerTeamId?.toString() ?? null,
      isTie: match.superOverTie ?? false
    },
    chase,
    superOverChase,
    isChase: innings.inningsNumber === 2 || (match.phase === 'SUPER_OVER' && innings.inningsNumber === 4),
    isMatchCompleted: match.status === 'COMPLETED',
    result
  };
  setCachedMatchScore(tenantId, matchId, response);
  return response;
};

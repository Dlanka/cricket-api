import { isValidObjectId } from 'mongoose';
import { TeamModel } from '../models/team';
import { TeamAccessLinkModel } from '../models/teamAccessLink';
import { PlayerModel } from '../models/player';
import { MatchModel } from '../models/match';
import { MatchPlayerModel } from '../models/matchPlayer';
import { InningsModel } from '../models/innings';
import { InningsBatterModel } from '../models/inningsBatter';
import { InningsBowlerModel } from '../models/inningsBowler';
import { ScoreEventModel } from '../models/scoreEvent';
import { TournamentModel } from '../models/tournament';
import { AppError } from '../utils/appError';
import { scopedDeleteOne, scopedFind, scopedFindOne } from '../utils/scopedQuery';

export type TournamentCreateInput = {
  tenantId: string;
  name: string;
  location?: string;
  startDate?: Date;
  endDate?: Date;
  type: 'LEAGUE' | 'KNOCKOUT' | 'LEAGUE_KNOCKOUT';
  oversPerInnings: number;
  ballsPerOver?: number;
  status?: 'DRAFT' | 'ACTIVE' | 'COMPLETED';
  rules?: {
    points?: {
      win?: number;
      tie?: number;
      noResult?: number;
      loss?: number;
    };
    qualificationCount?: number;
    seeding?: 'STANDARD';
  };
  stageStatus?: {
    league?: 'PENDING' | 'ACTIVE' | 'COMPLETED';
    knockout?: 'PENDING' | 'ACTIVE' | 'COMPLETED';
  };
};

export type TournamentUpdateInput = {
  name?: string;
  location?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  type?: 'LEAGUE' | 'KNOCKOUT' | 'LEAGUE_KNOCKOUT';
  oversPerInnings?: number;
  ballsPerOver?: number;
  status?: 'DRAFT' | 'ACTIVE' | 'COMPLETED';
  rules?: {
    points?: {
      win?: number;
      tie?: number;
      noResult?: number;
      loss?: number;
    };
    qualificationCount?: number;
    seeding?: 'STANDARD';
  };
  stageStatus?: {
    league?: 'PENDING' | 'ACTIVE' | 'COMPLETED';
    knockout?: 'PENDING' | 'ACTIVE' | 'COMPLETED';
  };
};

type StandingRow = {
  teamId: string;
  teamName: string;
  shortName?: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  noResult: number;
  points: number;
  runsFor: number;
  ballsFaced: number;
  runsAgainst: number;
  ballsBowled: number;
  netRunRate: number;
};

type KnockoutStage = 'R1' | 'QF' | 'SF' | 'FINAL';
type StatsSectionKey =
  | 'runs'
  | 'wickets'
  | 'highestScores'
  | 'bestBowlingFigures'
  | 'battingAverage'
  | 'bowlingAverage'
  | 'mostHundreds'
  | 'mostFifties'
  | 'mostEconomicalBowlers'
  | 'fiveWicketHauls'
  | 'sixes'
  | 'fours'
  | 'boundaries';

type BatterAggregate = {
  playerId: string | null;
  name: string;
  teamId: string | null;
  matches: number;
  runs: number;
  balls: number;
  dismissals: number;
  innings: number;
  highestScore: number;
  highestScoreBalls: number;
  hundreds: number;
  fifties: number;
  fours: number;
  sixes: number;
};

type BowlingBestFigure = {
  wickets: number;
  runsConceded: number;
  balls: number;
  ballsPerOver: number;
};

type BowlerAggregate = {
  playerId: string;
  name: string;
  teamId: string | null;
  matches: number;
  wickets: number;
  runsConceded: number;
  balls: number;
  oversEquivalent: number;
  innings: number;
  fiveWicketHauls: number;
  bestFigure: BowlingBestFigure;
};

const TOURNAMENT_STATS_LIMITS: Record<StatsSectionKey, number> = {
  runs: 5,
  wickets: 5,
  highestScores: 5,
  bestBowlingFigures: 5,
  battingAverage: 5,
  bowlingAverage: 5,
  mostHundreds: 5,
  mostFifties: 5,
  mostEconomicalBowlers: 5,
  fiveWicketHauls: 5,
  sixes: 5,
  fours: 5,
  boundaries: 5
};

const MIN_ECONOMY_OVERS = 2;

const ensureObjectId = (id: string, message: string) => {
  if (!isValidObjectId(id)) {
    throw new AppError(message, 400, 'validation.invalid_id');
  }
};

const getPointsRules = (
  tournament: {
    rules?: {
      points?: {
        win?: number;
        tie?: number;
        noResult?: number;
        loss?: number;
      };
    };
  }
) => ({
  win: tournament.rules?.points?.win ?? 2,
  tie: tournament.rules?.points?.tie ?? 1,
  noResult: tournament.rules?.points?.noResult ?? 1,
  loss: tournament.rules?.points?.loss ?? 0
});

const validateTournamentConfig = (
  type: 'LEAGUE' | 'KNOCKOUT' | 'LEAGUE_KNOCKOUT',
  qualificationCount?: number
) => {
  if (type !== 'LEAGUE_KNOCKOUT') {
    if (qualificationCount !== undefined) {
      throw new AppError(
        'qualificationCount is supported only for LEAGUE_KNOCKOUT tournaments.',
        400,
        'tournament.invalid_rules'
      );
    }
    return;
  }

  const normalized = qualificationCount ?? 4;
  if (normalized < 2) {
    throw new AppError('qualificationCount must be at least 2.', 400, 'tournament.invalid_rules');
  }

  if (![2, 4].includes(normalized)) {
    throw new AppError(
      'qualificationCount supports only 2 or 4 for standard knockout seeding.',
      400,
      'tournament.invalid_rules',
      {
        qualificationCount: {
          min: 2,
          allowed: [2, 4],
          reason: 'standard seeding currently supports FINAL (2) or SF (4) only'
        }
      }
    );
  }
};

const oversFromBalls = (balls: number, ballsPerOver: number) => balls / ballsPerOver;

const isKnockoutStage = (stage?: string | null): stage is KnockoutStage =>
  stage === 'R1' || stage === 'QF' || stage === 'SF' || stage === 'FINAL';

const resolveNextKnockoutStage = (winnerCount: number): KnockoutStage | null => {
  if (winnerCount > 8) return 'R1';
  if (winnerCount > 4) return 'QF';
  if (winnerCount > 2) return 'SF';
  if (winnerCount > 1) return 'FINAL';
  return null;
};

const buildTournamentOverviewDescription = (
  tournament: {
    type: 'LEAGUE' | 'KNOCKOUT' | 'LEAGUE_KNOCKOUT';
    status: 'DRAFT' | 'ACTIVE' | 'COMPLETED';
    oversPerInnings: number;
    ballsPerOver?: number;
    rules?: {
      points?: { win?: number; tie?: number; noResult?: number; loss?: number };
      qualificationCount?: number;
    };
    stageStatus?: {
      league?: 'PENDING' | 'ACTIVE' | 'COMPLETED';
      knockout?: 'PENDING' | 'ACTIVE' | 'COMPLETED';
    };
  },
  counts: {
    total: number;
    scheduled: number;
    live: number;
    completed: number;
    leagueTotal: number;
    leagueCompleted: number;
    knockoutTotal: number;
    knockoutCompleted: number;
  }
) => {
  const ballsPerOver = tournament.ballsPerOver ?? 6;
  const points = getPointsRules(tournament);
  const parts: string[] = [];

  parts.push(
    `Tournament is ${tournament.type} format and currently ${tournament.status}. Matches are ${tournament.oversPerInnings} overs per innings with ${ballsPerOver} balls per over.`
  );
  parts.push(
    `Progress: ${counts.completed}/${counts.total} completed, ${counts.live} live, ${counts.scheduled} scheduled.`
  );

  if (tournament.type === 'LEAGUE' || tournament.type === 'LEAGUE_KNOCKOUT') {
    parts.push(
      `League stage is ${tournament.stageStatus?.league ?? 'PENDING'} (${counts.leagueCompleted}/${counts.leagueTotal} completed).`
    );
    parts.push(
      `League points: win ${points.win}, tie ${points.tie}, no result ${points.noResult}, loss ${points.loss}.`
    );
  }

  if (tournament.type === 'LEAGUE_KNOCKOUT') {
    parts.push(
      `Top ${tournament.rules?.qualificationCount ?? 4} teams qualify to knockout. Knockout stage is ${tournament.stageStatus?.knockout ?? 'PENDING'} (${counts.knockoutCompleted}/${counts.knockoutTotal} completed).`
    );
  }

  if (tournament.type === 'KNOCKOUT') {
    parts.push(
      `Knockout progression: ${counts.knockoutCompleted}/${counts.knockoutTotal} completed in elimination rounds.`
    );
  }

  if (tournament.type === 'LEAGUE') {
    parts.push('Tied league matches remain tied and points are shared by tournament rules.');
  } else {
    parts.push(
      'Tied knockout matches move to Super Over; if still tied after Super Over, manual tie-break winner selection is required.'
    );
  }

  return parts.join(' ');
};

const buildTournamentOverview = (
  tournament: {
    type: 'LEAGUE' | 'KNOCKOUT' | 'LEAGUE_KNOCKOUT';
    status: 'DRAFT' | 'ACTIVE' | 'COMPLETED';
    oversPerInnings: number;
    ballsPerOver?: number;
    rules?: {
      points?: { win?: number; tie?: number; noResult?: number; loss?: number };
      qualificationCount?: number;
    };
    stageStatus?: {
      league?: 'PENDING' | 'ACTIVE' | 'COMPLETED';
      knockout?: 'PENDING' | 'ACTIVE' | 'COMPLETED';
    };
  },
  counts: {
    total: number;
    scheduled: number;
    live: number;
    completed: number;
    leagueTotal: number;
    leagueCompleted: number;
    knockoutTotal: number;
    knockoutCompleted: number;
  }
) => {
  const ballsPerOver = tournament.ballsPerOver ?? 6;
  const points = getPointsRules(tournament);

  return {
    type: tournament.type,
    status: tournament.status,
    settings: {
      oversPerInnings: tournament.oversPerInnings,
      ballsPerOver
    },
    progress: {
      totalMatches: counts.total,
      completedMatches: counts.completed,
      liveMatches: counts.live,
      scheduledMatches: counts.scheduled
    },
    stages: {
      league: {
        status:
          tournament.type === 'KNOCKOUT'
            ? 'PENDING'
            : (tournament.stageStatus?.league ?? 'PENDING'),
        totalMatches: counts.leagueTotal,
        completedMatches: counts.leagueCompleted
      },
      knockout: {
        status:
          tournament.type === 'LEAGUE'
            ? 'PENDING'
            : (tournament.stageStatus?.knockout ?? 'PENDING'),
        totalMatches: counts.knockoutTotal,
        completedMatches: counts.knockoutCompleted,
        qualificationCount: tournament.type === 'LEAGUE_KNOCKOUT'
          ? (tournament.rules?.qualificationCount ?? 4)
          : null
      }
    },
    rules: {
      points:
        tournament.type === 'LEAGUE' || tournament.type === 'LEAGUE_KNOCKOUT'
          ? {
              win: points.win,
              tie: points.tie,
              noResult: points.noResult,
              loss: points.loss
            }
          : null
    },
    tiePolicy:
      tournament.type === 'LEAGUE'
        ? 'LEAGUE_TIE_SHARED'
        : 'KNOCKOUT_SUPER_OVER_THEN_TIE_BREAK'
  };
};

const toPlayerName = (fullName: string | undefined, fallback: string) => fullName?.trim() || fallback;

const getLeagueStandingsRows = async (tenantId: string, tournamentId: string) => {
  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: tournamentId });
  if (!tournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  const [teams, leagueMatches] = await Promise.all([
    scopedFind(TeamModel, tenantId, { tournamentId }).sort({ createdAt: 1 }),
    scopedFind(MatchModel, tenantId, { tournamentId, stage: 'LEAGUE' }).sort({ createdAt: 1 })
  ]);
  const pointsRules = getPointsRules(tournament);
  const ballsPerOver = tournament.ballsPerOver ?? 6;

  const table = new Map<string, StandingRow>();
  teams.forEach((team) => {
    table.set(team._id.toString(), {
      teamId: team._id.toString(),
      teamName: team.name,
      shortName: team.shortName ?? undefined,
      played: 0,
      won: 0,
      lost: 0,
      tied: 0,
      noResult: 0,
      points: 0,
      runsFor: 0,
      ballsFaced: 0,
      runsAgainst: 0,
      ballsBowled: 0,
      netRunRate: 0
    });
  });

  const completedLeagueMatches = leagueMatches.filter(
    (match) => match.status === 'COMPLETED' && match.teamBId
  );
  const matchIds = completedLeagueMatches.map((match) => match._id.toString());

  const innings = matchIds.length
    ? await scopedFind(InningsModel, tenantId, { matchId: { $in: matchIds } })
    : [];
  const inningsByMatch = new Map<string, typeof innings>();
  innings.forEach((entry) => {
    const key = entry.matchId.toString();
    const rows = inningsByMatch.get(key) ?? [];
    rows.push(entry);
    inningsByMatch.set(key, rows);
  });

  completedLeagueMatches.forEach((match) => {
    const teamAId = match.teamAId.toString();
    const teamBId = match.teamBId?.toString();
    if (!teamBId) return;

    const teamA = table.get(teamAId);
    const teamB = table.get(teamBId);
    if (!teamA || !teamB) return;

    teamA.played += 1;
    teamB.played += 1;

    const matchInnings = inningsByMatch.get(match._id.toString()) ?? [];
    const teamAInnings = matchInnings.find((entry) => entry.battingTeamId.toString() === teamAId);
    const teamBInnings = matchInnings.find((entry) => entry.battingTeamId.toString() === teamBId);

    if (teamAInnings) {
      teamA.runsFor += teamAInnings.runs;
      teamA.ballsFaced += teamAInnings.balls;
      teamB.runsAgainst += teamAInnings.runs;
      teamB.ballsBowled += teamAInnings.balls;
    }

    if (teamBInnings) {
      teamB.runsFor += teamBInnings.runs;
      teamB.ballsFaced += teamBInnings.balls;
      teamA.runsAgainst += teamBInnings.runs;
      teamA.ballsBowled += teamBInnings.balls;
    }

    const winnerTeamId = match.result?.winnerTeamId?.toString();
    const isTie = match.result?.type === 'TIE';
    const isNoResult = match.result?.type === 'NO_RESULT' || match.result?.isNoResult === true;

    if (isNoResult) {
      teamA.noResult += 1;
      teamB.noResult += 1;
      teamA.points += pointsRules.noResult;
      teamB.points += pointsRules.noResult;
      return;
    }

    if (isTie || !winnerTeamId) {
      teamA.tied += 1;
      teamB.tied += 1;
      teamA.points += pointsRules.tie;
      teamB.points += pointsRules.tie;
      return;
    }

    if (winnerTeamId === teamAId) {
      teamA.won += 1;
      teamA.points += pointsRules.win;
      teamB.lost += 1;
      teamB.points += pointsRules.loss;
    } else if (winnerTeamId === teamBId) {
      teamB.won += 1;
      teamB.points += pointsRules.win;
      teamA.lost += 1;
      teamA.points += pointsRules.loss;
    }
  });

  const rows = [...table.values()].map((row) => {
    const runRateFor =
      row.ballsFaced > 0 ? row.runsFor / oversFromBalls(row.ballsFaced, ballsPerOver) : 0;
    const runRateAgainst =
      row.ballsBowled > 0 ? row.runsAgainst / oversFromBalls(row.ballsBowled, ballsPerOver) : 0;
    return {
      ...row,
      netRunRate: Number((runRateFor - runRateAgainst).toFixed(3))
    };
  });

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.netRunRate !== a.netRunRate) return b.netRunRate - a.netRunRate;
    if (b.won !== a.won) return b.won - a.won;
    return a.teamName.localeCompare(b.teamName);
  });

  return { rows, leagueMatchesCount: leagueMatches.length, completedCount: completedLeagueMatches.length };
};

export const createTournament = async (input: TournamentCreateInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  validateTournamentConfig(input.type, input.rules?.qualificationCount);

  const status = input.status ?? 'DRAFT';
  const requestedLeagueStage = input.stageStatus?.league;
  const leagueStage =
    requestedLeagueStage ??
    (status === 'ACTIVE'
      ? 'ACTIVE'
      : status === 'COMPLETED'
        ? 'COMPLETED'
        : input.type === 'KNOCKOUT'
          ? 'PENDING'
          : 'PENDING');
  const knockoutStage =
    input.stageStatus?.knockout ??
    (status === 'COMPLETED' && input.type !== 'LEAGUE' ? 'COMPLETED' : 'PENDING');

  const tournament = await TournamentModel.create({
    tenantId: input.tenantId,
    name: input.name,
    location: input.location,
    startDate: input.startDate,
    endDate: input.endDate,
    type: input.type,
    oversPerInnings: input.oversPerInnings,
    ballsPerOver: input.ballsPerOver,
    status,
    rules: {
      points: {
        win: input.rules?.points?.win ?? 2,
        tie: input.rules?.points?.tie ?? 1,
        noResult: input.rules?.points?.noResult ?? 1,
        loss: input.rules?.points?.loss ?? 0
      },
      qualificationCount: input.rules?.qualificationCount ?? 4,
      seeding: input.rules?.seeding ?? 'STANDARD'
    },
    stageStatus: {
      league: leagueStage,
      knockout: knockoutStage
    }
  });

  return tournament;
};

export const listTournaments = async (tenantId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  return scopedFind(TournamentModel, tenantId).sort({ createdAt: -1 });
};

export const getTournamentStats = async (tenantId: string, id: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid tournament id.');

  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: id });
  if (!tournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  const matches = await scopedFind(MatchModel, tenantId, { tournamentId: id }).select({ _id: 1 });
  const matchIds = matches.map((entry) => entry._id);

  if (matchIds.length === 0) {
    return {
      tournamentId: tournament._id.toString(),
      limits: TOURNAMENT_STATS_LIMITS,
      sections: {
        runs: [],
        wickets: [],
        highestScores: [],
        bestBowlingFigures: [],
        battingAverage: [],
        bowlingAverage: [],
        mostHundreds: [],
        mostFifties: [],
        mostEconomicalBowlers: [],
        fiveWicketHauls: [],
        sixes: [],
        fours: [],
        boundaries: []
      }
    };
  }

  const innings = await scopedFind(InningsModel, tenantId, { matchId: { $in: matchIds } }).select({
    _id: 1,
    matchId: 1,
    ballsPerOver: 1
  });
  const inningsIds = innings.map((entry) => entry._id);
  const inningsMatchId = new Map<string, string>(
    innings.map((entry) => [entry._id.toString(), entry.matchId.toString()])
  );
  const inningsBallsPerOver = new Map<string, number>(
    innings.map((entry) => [entry._id.toString(), entry.ballsPerOver ?? tournament.ballsPerOver ?? 6])
  );

  if (inningsIds.length === 0) {
    return {
      tournamentId: tournament._id.toString(),
      limits: TOURNAMENT_STATS_LIMITS,
      sections: {
        runs: [],
        wickets: [],
        highestScores: [],
        bestBowlingFigures: [],
        battingAverage: [],
        bowlingAverage: [],
        mostHundreds: [],
        mostFifties: [],
        mostEconomicalBowlers: [],
        fiveWicketHauls: [],
        sixes: [],
        fours: [],
        boundaries: []
      }
    };
  }

  const [batterRows, bowlerRows] = await Promise.all([
    scopedFind(InningsBatterModel, tenantId, { inningsId: { $in: inningsIds } }).select({
      _id: 1,
      inningsId: 1,
      playerRef: 1,
      batterKey: 1,
      runs: 1,
      balls: 1,
      fours: 1,
      sixes: 1,
      isOut: 1,
      outKind: 1
    }),
    scopedFind(InningsBowlerModel, tenantId, { inningsId: { $in: inningsIds } }).select({
      _id: 1,
      inningsId: 1,
      playerId: 1,
      name: 1,
      runsConceded: 1,
      balls: 1,
      wickets: 1
    })
  ]);

  const playerIds = new Set<string>();
  batterRows.forEach((entry) => {
    const playerId = entry.playerRef?.playerId?.toString() ?? entry.batterKey?.playerId?.toString();
    if (playerId) {
      playerIds.add(playerId);
    }
  });
  bowlerRows.forEach((entry) => playerIds.add(entry.playerId.toString()));

  const players = playerIds.size
    ? await PlayerModel.find({ tenantId, _id: { $in: [...playerIds] } }).select({
        _id: 1,
        fullName: 1,
        teamId: 1
      })
    : [];

  const teamIds = [...new Set(players.map((entry) => entry.teamId.toString()))];
  const teams = teamIds.length
    ? await TeamModel.find({ tenantId, _id: { $in: teamIds } }).select({ _id: 1, name: 1, shortName: 1 })
    : [];

  const playerMap = new Map(
    players.map((entry) => [
      entry._id.toString(),
      {
        fullName: entry.fullName,
        teamId: entry.teamId.toString()
      }
    ])
  );
  const teamMap = new Map(
    teams.map((entry) => [
      entry._id.toString(),
      {
        id: entry._id.toString(),
        name: entry.name,
        shortName: entry.shortName ?? null
      }
    ])
  );

  const batterAggMap = new Map<string, BatterAggregate>();
  const batterMatchMap = new Map<string, Set<string>>();
  batterRows.forEach((entry) => {
    const playerId = entry.playerRef?.playerId?.toString() ?? entry.batterKey?.playerId?.toString() ?? null;
    const rawName = entry.playerRef?.name ?? entry.batterKey?.name ?? 'Unknown Player';
    const key = playerId ? `pid:${playerId}` : `name:${rawName.toLowerCase()}`;
    const matchId = inningsMatchId.get(entry.inningsId.toString());
    const player = playerId ? playerMap.get(playerId) : undefined;
    const outKind = entry.outKind ?? null;
    const dismissalCount =
      entry.isOut && outKind !== 'retired' && outKind !== 'retiredHurt' ? 1 : 0;
    const existing = batterAggMap.get(key);

    if (!existing) {
      const matches = new Set<string>();
      if (matchId) matches.add(matchId);
      batterMatchMap.set(key, matches);
      batterAggMap.set(key, {
        playerId,
        name: toPlayerName(player?.fullName, rawName),
        teamId: player?.teamId ?? null,
        matches: matches.size,
        runs: entry.runs,
        balls: entry.balls,
        dismissals: dismissalCount,
        innings: 1,
        highestScore: entry.runs,
        highestScoreBalls: entry.balls,
        hundreds: entry.runs >= 100 ? 1 : 0,
        fifties: entry.runs >= 50 && entry.runs < 100 ? 1 : 0,
        fours: entry.fours,
        sixes: entry.sixes
      });
      return;
    }

    const matches = batterMatchMap.get(key) ?? new Set<string>();
    if (matchId) matches.add(matchId);
    batterMatchMap.set(key, matches);

    existing.matches = matches.size;
    existing.runs += entry.runs;
    existing.balls += entry.balls;
    existing.dismissals += dismissalCount;
    existing.innings += 1;
    if (
      entry.runs > existing.highestScore ||
      (entry.runs === existing.highestScore && entry.balls < existing.highestScoreBalls)
    ) {
      existing.highestScore = entry.runs;
      existing.highestScoreBalls = entry.balls;
    }
    existing.hundreds += entry.runs >= 100 ? 1 : 0;
    existing.fifties += entry.runs >= 50 && entry.runs < 100 ? 1 : 0;
    existing.fours += entry.fours;
    existing.sixes += entry.sixes;
  });

  const bowlerAggMap = new Map<string, BowlerAggregate>();
  const bowlerMatchMap = new Map<string, Set<string>>();
  bowlerRows.forEach((entry) => {
    const playerId = entry.playerId.toString();
    const matchId = inningsMatchId.get(entry.inningsId.toString());
    const player = playerMap.get(playerId);
    const ballsPerOver = inningsBallsPerOver.get(entry.inningsId.toString()) ?? tournament.ballsPerOver ?? 6;
    const oversEquivalent = ballsPerOver > 0 ? entry.balls / ballsPerOver : 0;
    const existing = bowlerAggMap.get(playerId);

    if (!existing) {
      const matches = new Set<string>();
      if (matchId) matches.add(matchId);
      bowlerMatchMap.set(playerId, matches);
      bowlerAggMap.set(playerId, {
        playerId,
        name: toPlayerName(player?.fullName, entry.name || 'Unknown Player'),
        teamId: player?.teamId ?? null,
        matches: matches.size,
        wickets: entry.wickets,
        runsConceded: entry.runsConceded,
        balls: entry.balls,
        oversEquivalent,
        innings: 1,
        fiveWicketHauls: entry.wickets >= 5 ? 1 : 0,
        bestFigure: {
          wickets: entry.wickets,
          runsConceded: entry.runsConceded,
          balls: entry.balls,
          ballsPerOver
        }
      });
      return;
    }

    const matches = bowlerMatchMap.get(playerId) ?? new Set<string>();
    if (matchId) matches.add(matchId);
    bowlerMatchMap.set(playerId, matches);

    existing.matches = matches.size;
    existing.wickets += entry.wickets;
    existing.runsConceded += entry.runsConceded;
    existing.balls += entry.balls;
    existing.oversEquivalent += oversEquivalent;
    existing.innings += 1;
    existing.fiveWicketHauls += entry.wickets >= 5 ? 1 : 0;

    const isBetterFigure =
      entry.wickets > existing.bestFigure.wickets ||
      (entry.wickets === existing.bestFigure.wickets &&
        entry.runsConceded < existing.bestFigure.runsConceded) ||
      (entry.wickets === existing.bestFigure.wickets &&
        entry.runsConceded === existing.bestFigure.runsConceded &&
        entry.balls < existing.bestFigure.balls);
    if (isBetterFigure) {
      existing.bestFigure = {
        wickets: entry.wickets,
        runsConceded: entry.runsConceded,
        balls: entry.balls,
        ballsPerOver
      };
    }
  });

  const batters = [...batterAggMap.values()];
  const bowlers = [...bowlerAggMap.values()];

  const withTeam = (teamId: string | null) =>
    teamId
      ? (teamMap.get(teamId) ?? {
          id: teamId,
          name: 'Unknown Team',
          shortName: null
        })
      : null;

  const sections = {
    runs: batters
      .slice()
      .sort((a, b) => b.runs - a.runs || b.highestScore - a.highestScore || a.name.localeCompare(b.name))
      .slice(0, TOURNAMENT_STATS_LIMITS.runs)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        runs: entry.runs,
        innings: entry.innings,
        average: entry.dismissals > 0 ? Number((entry.runs / entry.dismissals).toFixed(2)) : 0
      })),
    wickets: bowlers
      .slice()
      .sort((a, b) => b.wickets - a.wickets || a.runsConceded - b.runsConceded || a.name.localeCompare(b.name))
      .slice(0, TOURNAMENT_STATS_LIMITS.wickets)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        wickets: entry.wickets,
        innings: entry.innings,
        economy:
          entry.oversEquivalent > 0 ? Number((entry.runsConceded / entry.oversEquivalent).toFixed(2)) : 0
      })),
    highestScores: batters
      .slice()
      .sort((a, b) => b.highestScore - a.highestScore || b.runs - a.runs || a.name.localeCompare(b.name))
      .slice(0, TOURNAMENT_STATS_LIMITS.highestScores)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        highestScore: entry.highestScore,
        strikeRate: entry.highestScoreBalls > 0 ? Number(((entry.highestScore / entry.highestScoreBalls) * 100).toFixed(2)) : 0
      })),
    bestBowlingFigures: bowlers
      .slice()
      .sort(
        (a, b) =>
          b.bestFigure.wickets - a.bestFigure.wickets ||
          a.bestFigure.runsConceded - b.bestFigure.runsConceded ||
          a.name.localeCompare(b.name)
      )
      .slice(0, TOURNAMENT_STATS_LIMITS.bestBowlingFigures)
      .map((entry, index) => ({
        bestEconomy:
          entry.bestFigure.balls > 0 && entry.bestFigure.ballsPerOver > 0
            ? Number(
                (
                  entry.bestFigure.runsConceded /
                  (entry.bestFigure.balls / entry.bestFigure.ballsPerOver)
                ).toFixed(2)
              )
            : 0,
        bestOvers:
          entry.bestFigure.ballsPerOver > 0
            ? Number((entry.bestFigure.balls / entry.bestFigure.ballsPerOver).toFixed(1))
            : 0,
        bestBowling: `${entry.bestFigure.wickets}/${entry.bestFigure.runsConceded}`,
        row: entry,
        index
      }))
      .map((item) => ({
        rank: item.index + 1,
        playerId: item.row.playerId,
        name: item.row.name,
        team: withTeam(item.row.teamId),
        wickets: item.row.bestFigure.wickets,
        runsConceded: item.row.bestFigure.runsConceded,
        overs: item.bestOvers,
        economy: item.bestEconomy,
        bestBowling: item.bestBowling
      })),
    battingAverage: batters
      .filter((entry) => entry.dismissals > 0)
      .map((entry) => ({
        ...entry,
        average: Number((entry.runs / entry.dismissals).toFixed(2))
      }))
      .sort((a, b) => b.average - a.average || b.runs - a.runs || a.name.localeCompare(b.name))
      .slice(0, TOURNAMENT_STATS_LIMITS.battingAverage)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        matches: entry.matches,
        average: entry.average,
        runs: entry.runs,
        dismissals: entry.dismissals
      })),
    bowlingAverage: bowlers
      .filter((entry) => entry.wickets > 0)
      .map((entry) => ({
        ...entry,
        average: Number((entry.runsConceded / entry.wickets).toFixed(2))
      }))
      .sort((a, b) => a.average - b.average || b.wickets - a.wickets || a.name.localeCompare(b.name))
      .slice(0, TOURNAMENT_STATS_LIMITS.bowlingAverage)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        matches: entry.matches,
        average: entry.average,
        wickets: entry.wickets,
        runsConceded: entry.runsConceded
      })),
    mostHundreds: batters
      .slice()
      .filter((entry) => entry.hundreds > 0)
      .sort((a, b) => b.hundreds - a.hundreds || b.runs - a.runs || a.name.localeCompare(b.name))
      .slice(0, TOURNAMENT_STATS_LIMITS.mostHundreds)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        matches: entry.matches,
        runs: entry.runs,
        hundreds: entry.hundreds
      })),
    mostFifties: batters
      .slice()
      .filter((entry) => entry.fifties > 0)
      .sort((a, b) => b.fifties - a.fifties || b.runs - a.runs || a.name.localeCompare(b.name))
      .slice(0, TOURNAMENT_STATS_LIMITS.mostFifties)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        matches: entry.matches,
        runs: entry.runs,
        fifties: entry.fifties
      })),
    mostEconomicalBowlers: bowlers
      .filter((entry) => entry.oversEquivalent >= MIN_ECONOMY_OVERS)
      .map((entry) => ({
        ...entry,
        economy:
          entry.oversEquivalent > 0
            ? Number((entry.runsConceded / entry.oversEquivalent).toFixed(2))
            : 0
      }))
      .sort((a, b) => a.economy - b.economy || b.wickets - a.wickets || a.name.localeCompare(b.name))
      .slice(0, TOURNAMENT_STATS_LIMITS.mostEconomicalBowlers)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        economy: entry.economy,
        overs: Number(entry.oversEquivalent.toFixed(1)),
        runsConceded: entry.runsConceded
      })),
    fiveWicketHauls: bowlers
      .slice()
      .filter((entry) => entry.fiveWicketHauls > 0)
      .sort(
        (a, b) =>
          b.fiveWicketHauls - a.fiveWicketHauls || b.wickets - a.wickets || a.name.localeCompare(b.name)
      )
      .slice(0, TOURNAMENT_STATS_LIMITS.fiveWicketHauls)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        matches: entry.matches,
        wickets: entry.wickets,
        fiveWicketHauls: entry.fiveWicketHauls
      })),
    sixes: batters
      .slice()
      .filter((entry) => entry.sixes > 0)
      .sort((a, b) => b.sixes - a.sixes || b.runs - a.runs || a.name.localeCompare(b.name))
      .slice(0, TOURNAMENT_STATS_LIMITS.sixes)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        matches: entry.matches,
        runs: entry.runs,
        sixes: entry.sixes
      })),
    fours: batters
      .slice()
      .filter((entry) => entry.fours > 0)
      .sort((a, b) => b.fours - a.fours || b.runs - a.runs || a.name.localeCompare(b.name))
      .slice(0, TOURNAMENT_STATS_LIMITS.fours)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        matches: entry.matches,
        runs: entry.runs,
        fours: entry.fours
      })),
    boundaries: batters
      .map((entry) => ({
        ...entry,
        boundaries: entry.fours + entry.sixes
      }))
      .filter((entry) => entry.boundaries > 0)
      .sort((a, b) => b.boundaries - a.boundaries || b.runs - a.runs || a.name.localeCompare(b.name))
      .slice(0, TOURNAMENT_STATS_LIMITS.boundaries)
      .map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        team: withTeam(entry.teamId),
        boundaries: entry.boundaries,
        fours: entry.fours,
        sixes: entry.sixes
      }))
  };

  return {
    tournamentId: tournament._id.toString(),
    limits: TOURNAMENT_STATS_LIMITS,
    sections
  };
};

export const getTournamentPlayerOfSeries = async (tenantId: string, id: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid tournament id.');

  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: id });
  if (!tournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  const matches = await scopedFind(MatchModel, tenantId, { tournamentId: id }).select({ _id: 1 });
  const matchIds = matches.map((entry) => entry._id);

  if (matchIds.length === 0) {
    return { tournamentId: tournament._id.toString(), winner: null, leaderboard: [] };
  }

  const innings = await scopedFind(InningsModel, tenantId, { matchId: { $in: matchIds } }).select({
    _id: 1,
    matchId: 1,
    ballsPerOver: 1
  });
  const inningsIds = innings.map((entry) => entry._id);
  const inningsMatchId = new Map<string, string>(
    innings.map((entry) => [entry._id.toString(), entry.matchId.toString()])
  );

  if (inningsIds.length === 0) {
    return { tournamentId: tournament._id.toString(), winner: null, leaderboard: [] };
  }

  const [batterRows, bowlerRows] = await Promise.all([
    scopedFind(InningsBatterModel, tenantId, { inningsId: { $in: inningsIds } }).select({
      inningsId: 1,
      playerRef: 1,
      batterKey: 1,
      runs: 1,
      balls: 1,
      fours: 1,
      sixes: 1,
      isOut: 1,
      outKind: 1,
      outFielderId: 1
    }),
    scopedFind(InningsBowlerModel, tenantId, { inningsId: { $in: inningsIds } }).select({
      inningsId: 1,
      playerId: 1,
      name: 1,
      runsConceded: 1,
      balls: 1,
      wickets: 1
    })
  ]);

  const playerIds = new Set<string>();
  batterRows.forEach((entry) => {
    const playerId = entry.playerRef?.playerId?.toString() ?? entry.batterKey?.playerId?.toString();
    if (playerId) playerIds.add(playerId);
    const outFielderId = entry.outFielderId?.toString();
    if (outFielderId) playerIds.add(outFielderId);
  });
  bowlerRows.forEach((entry) => playerIds.add(entry.playerId.toString()));

  const players = playerIds.size
    ? await PlayerModel.find({ tenantId, _id: { $in: [...playerIds] } }).select({
        _id: 1,
        fullName: 1,
        teamId: 1
      })
    : [];
  const teamIds = [...new Set(players.map((entry) => entry.teamId.toString()))];
  const teams = teamIds.length
    ? await TeamModel.find({ tenantId, _id: { $in: teamIds } }).select({ _id: 1, name: 1, shortName: 1 })
    : [];

  const playerMap = new Map(
    players.map((entry) => [
      entry._id.toString(),
      { fullName: entry.fullName, teamId: entry.teamId.toString() }
    ])
  );
  const teamMap = new Map(
    teams.map((entry) => [
      entry._id.toString(),
      { id: entry._id.toString(), name: entry.name, shortName: entry.shortName ?? null }
    ])
  );

  type PlayerAwardAgg = {
    playerId: string | null;
    name: string;
    teamId: string | null;
    matches: Set<string>;
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
    wickets: number;
    ballsBowled: number;
    runsConceded: number;
    fifties: number;
    hundreds: number;
    fiveWicketHauls: number;
    catches: number;
    runOuts: number;
  };

  const aggMap = new Map<string, PlayerAwardAgg>();
  const ensureAgg = (playerId: string | null, fallbackName: string) => {
    const key = playerId ? `pid:${playerId}` : `name:${fallbackName.toLowerCase()}`;
    const existing = aggMap.get(key);
    if (existing) return existing;
    const player = playerId ? playerMap.get(playerId) : undefined;
    const created: PlayerAwardAgg = {
      playerId,
      name: player?.fullName ?? fallbackName,
      teamId: player?.teamId ?? null,
      matches: new Set<string>(),
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      wickets: 0,
      ballsBowled: 0,
      runsConceded: 0,
      fifties: 0,
      hundreds: 0,
      fiveWicketHauls: 0
      ,
      catches: 0,
      runOuts: 0
    };
    aggMap.set(key, created);
    return created;
  };

  batterRows.forEach((entry) => {
    const playerId = entry.playerRef?.playerId?.toString() ?? entry.batterKey?.playerId?.toString() ?? null;
    const name = entry.playerRef?.name ?? entry.batterKey?.name ?? 'Unknown Player';
    const agg = ensureAgg(playerId, name);
    const matchId = inningsMatchId.get(entry.inningsId.toString());
    if (matchId) agg.matches.add(matchId);
    agg.runs += entry.runs;
    agg.balls += entry.balls;
    agg.fours += entry.fours;
    agg.sixes += entry.sixes;
    if (entry.runs >= 100) agg.hundreds += 1;
    else if (entry.runs >= 50) agg.fifties += 1;

    const fielderId = entry.outFielderId?.toString() ?? null;
    if (fielderId) {
      const fielderAgg = ensureAgg(fielderId, 'Unknown Player');
      const fielderMatchId = inningsMatchId.get(entry.inningsId.toString());
      if (fielderMatchId) fielderAgg.matches.add(fielderMatchId);

      if (entry.outKind === 'caught') {
        fielderAgg.catches += 1;
      } else if (entry.outKind === 'runOut') {
        fielderAgg.runOuts += 1;
      }
    }
  });

  bowlerRows.forEach((entry) => {
    const playerId = entry.playerId.toString();
    const agg = ensureAgg(playerId, entry.name || 'Unknown Player');
    const matchId = inningsMatchId.get(entry.inningsId.toString());
    if (matchId) agg.matches.add(matchId);
    agg.wickets += entry.wickets;
    agg.ballsBowled += entry.balls;
    agg.runsConceded += entry.runsConceded;
    if (entry.wickets >= 5) agg.fiveWicketHauls += 1;
  });

  const leaderboard = [...aggMap.values()]
    .map((entry) => {
      const ballsPerOver = tournament.ballsPerOver ?? 6;
      const oversBowled = entry.ballsBowled / ballsPerOver;
      const economy = oversBowled > 0 ? entry.runsConceded / oversBowled : 0;
      const strikeRate = entry.balls > 0 ? (entry.runs / entry.balls) * 100 : 0;
      const economyBonus = oversBowled >= 2 ? (economy < 6 ? 10 : economy < 7 ? 5 : 0) : 0;
      const fieldingPoints = entry.catches * 8 + entry.runOuts * 10;
      const points =
        entry.runs +
        entry.wickets * 25 +
        entry.fours * 2 +
        entry.sixes * 3 +
        entry.fifties * 8 +
        entry.hundreds * 16 +
        entry.fiveWicketHauls * 20 +
        fieldingPoints +
        economyBonus;

      return {
        playerId: entry.playerId,
        name: entry.name,
        team: entry.teamId ? teamMap.get(entry.teamId) ?? null : null,
        matches: entry.matches.size,
        runs: entry.runs,
        wickets: entry.wickets,
        fours: entry.fours,
        sixes: entry.sixes,
        fifties: entry.fifties,
        hundreds: entry.hundreds,
        fiveWicketHauls: entry.fiveWicketHauls,
        catches: entry.catches,
        runOuts: entry.runOuts,
        strikeRate: Number(strikeRate.toFixed(2)),
        economy: Number(economy.toFixed(2)),
        points: Number(points.toFixed(2))
      };
    })
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wickets !== a.wickets) return b.wickets - a.wickets;
      if (b.runs !== a.runs) return b.runs - a.runs;
      return a.name.localeCompare(b.name);
    })
    .map((entry, index) => ({ rank: index + 1, ...entry }));

  return {
    tournamentId: tournament._id.toString(),
    winner: leaderboard[0] ?? null,
    leaderboard: leaderboard.slice(0, 10),
    scoring: {
      run: 1,
      wicket: 25,
      four: 2,
      six: 3,
      fiftyBonus: 8,
      hundredBonus: 16,
      fiveWicketBonus: 20,
      catch: 8,
      runOut: 10
    }
  };
};

export const getTournamentStandings = async (tenantId: string, id: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid tournament id.');

  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: id });
  if (!tournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  if (tournament.type !== 'LEAGUE' && tournament.type !== 'LEAGUE_KNOCKOUT') {
    throw new AppError('Standings are available for league formats only.', 400, 'tournament.unsupported_type');
  }

  const { rows, leagueMatchesCount, completedCount } = await getLeagueStandingsRows(tenantId, id);
  return {
    tournamentId: tournament._id.toString(),
    stage: 'LEAGUE',
    leagueCompleted: leagueMatchesCount > 0 && completedCount >= leagueMatchesCount,
    totalLeagueMatches: leagueMatchesCount,
    completedLeagueMatches: completedCount,
    items: rows.map((row, index) => ({
      rank: index + 1,
      team: {
        id: row.teamId,
        name: row.teamName,
        shortName: row.shortName ?? null
      },
      played: row.played,
      won: row.won,
      lost: row.lost,
      tied: row.tied,
      noResult: row.noResult,
      points: row.points,
      netRunRate: row.netRunRate
    }))
  };
};

export const recomputeTournamentStandings = async (tenantId: string, id: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid tournament id.');

  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: id });
  if (!tournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  if (tournament.type !== 'LEAGUE' && tournament.type !== 'LEAGUE_KNOCKOUT') {
    throw new AppError('Standings are available for league formats only.', 400, 'tournament.unsupported_type');
  }

  const { rows } = await getLeagueStandingsRows(tenantId, id);
  return {
    ok: true,
    computedAt: new Date().toISOString(),
    rowCount: rows.length
  };
};

export const generateKnockoutFromLeague = async (tenantId: string, id: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid tournament id.');

  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: id });
  if (!tournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  if (tournament.type !== 'LEAGUE_KNOCKOUT') {
    throw new AppError(
      'Knockout generation from standings is supported only for LEAGUE_KNOCKOUT.',
      400,
      'tournament.unsupported_type'
    );
  }

  const existingKnockout = await scopedFindOne(MatchModel, tenantId, {
    tournamentId: id,
    stage: { $in: ['R1', 'QF', 'SF', 'FINAL'] }
  });
  if (existingKnockout) {
    throw new AppError('Knockout matches already exist.', 409, 'match.already_exists');
  }

  const { rows, leagueMatchesCount, completedCount } = await getLeagueStandingsRows(tenantId, id);
  if (leagueMatchesCount === 0) {
    throw new AppError('No league fixtures found.', 400, 'match.not_found');
  }
  if (completedCount < leagueMatchesCount) {
    throw new AppError(
      'Complete all league matches before generating knockout.',
      409,
      'tournament.league_not_completed'
    );
  }

  if (rows.length < 2) {
    throw new AppError('At least two teams are required for knockout.', 400, 'match.insufficient_teams');
  }

  const qualificationCount = tournament.rules?.qualificationCount ?? 4;
  if (![2, 4].includes(qualificationCount)) {
    throw new AppError(
      'qualificationCount supports only 2 or 4 for standard knockout seeding.',
      400,
      'tournament.invalid_rules',
      {
        qualificationCount: {
          min: 2,
          allowed: [2, 4],
          reason: 'standard seeding currently supports FINAL (2) or SF (4) only'
        }
      }
    );
  }

  const top = rows.slice(0, Math.min(qualificationCount, rows.length));
  if (top.length < qualificationCount) {
    throw new AppError(
      'Not enough teams to generate knockout with current qualificationCount.',
      400,
      'tournament.invalid_rules',
      {
        qualificationCount: {
          min: 2,
          max: rows.length,
          reason: 'cannot exceed qualified standings rows'
        }
      }
    );
  }
  const matchesToCreate: Array<{
    tenantId: string;
    tournamentId: string;
    teamAId: string;
    teamBId: string;
    stage: 'SF' | 'FINAL';
    status: 'SCHEDULED';
    roundNumber: number;
  }> = [];

  if (qualificationCount >= 4) {
    matchesToCreate.push(
      {
        tenantId,
        tournamentId: id,
        teamAId: top[0].teamId,
        teamBId: top[3].teamId,
        stage: 'SF',
        status: 'SCHEDULED',
        roundNumber: 1
      },
      {
        tenantId,
        tournamentId: id,
        teamAId: top[1].teamId,
        teamBId: top[2].teamId,
        stage: 'SF',
        status: 'SCHEDULED',
        roundNumber: 1
      }
    );
  } else {
    matchesToCreate.push({
      tenantId,
      tournamentId: id,
      teamAId: top[0].teamId,
      teamBId: top[1].teamId,
      stage: 'FINAL',
      status: 'SCHEDULED',
      roundNumber: 1
    });
  }

  const created = await MatchModel.insertMany(matchesToCreate);
  tournament.stageStatus = {
    league: tournament.stageStatus?.league ?? 'COMPLETED',
    knockout: 'ACTIVE'
  };
  await tournament.save();

  return {
    created: created.map((entry) => ({
      id: entry._id.toString(),
      stage: entry.stage,
      teamAId: entry.teamAId.toString(),
      teamBId: entry.teamBId?.toString() ?? null
    }))
  };
};

export const getTournamentById = async (tenantId: string, id: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid tournament id.');

  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: id });

  if (!tournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  const [total, scheduled, live, completed, leagueTotal, leagueCompleted, knockoutTotal, knockoutCompleted] =
    await Promise.all([
      MatchModel.countDocuments({ tenantId, tournamentId: id }),
      MatchModel.countDocuments({ tenantId, tournamentId: id, status: 'SCHEDULED' }),
      MatchModel.countDocuments({ tenantId, tournamentId: id, status: 'LIVE' }),
      MatchModel.countDocuments({ tenantId, tournamentId: id, status: 'COMPLETED' }),
      MatchModel.countDocuments({ tenantId, tournamentId: id, stage: 'LEAGUE' }),
      MatchModel.countDocuments({ tenantId, tournamentId: id, stage: 'LEAGUE', status: 'COMPLETED' }),
      MatchModel.countDocuments({ tenantId, tournamentId: id, stage: { $in: ['R1', 'QF', 'SF', 'FINAL'] } }),
      MatchModel.countDocuments({
        tenantId,
        tournamentId: id,
        stage: { $in: ['R1', 'QF', 'SF', 'FINAL'] },
        status: 'COMPLETED'
      })
    ]);

  const overviewDescription = buildTournamentOverviewDescription(tournament, {
    total,
    scheduled,
    live,
    completed,
    leagueTotal,
    leagueCompleted,
    knockoutTotal,
    knockoutCompleted
  });
  const overview = buildTournamentOverview(tournament, {
    total,
    scheduled,
    live,
    completed,
    leagueTotal,
    leagueCompleted,
    knockoutTotal,
    knockoutCompleted
  });

  return {
    ...tournament.toObject(),
    overviewDescription,
    overview
  };
};

export const updateTournament = async (
  tenantId: string,
  id: string,
  updates: TournamentUpdateInput
) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid tournament id.');

  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: id });

  if (!tournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  const hasFixtures = await scopedFindOne(MatchModel, tenantId, { tournamentId: id });
  const startedMatch = await scopedFindOne(MatchModel, tenantId, {
    tournamentId: id,
    $or: [{ status: 'LIVE' }, { status: 'COMPLETED', teamBId: { $ne: null } }]
  });

  if (startedMatch && updates.type !== undefined && updates.type !== tournament.type) {
    throw new AppError(
      'Tournament type cannot be changed after a match has started.',
      409,
      'tournament.type_locked'
    );
  }

  const wantsConfigChange =
    updates.type !== undefined ||
    updates.oversPerInnings !== undefined ||
    updates.ballsPerOver !== undefined ||
    updates.rules !== undefined;

  if (hasFixtures && wantsConfigChange) {
    if (startedMatch) {
      throw new AppError(
        'Tournament format and over configuration are locked after a match has started.',
        409,
        'tournament.config_locked'
      );
    }

    // Regenerate flow support: allow config updates while fixtures are still scheduled
    // and no score artifacts exist yet.
    const matchIds = (
      await scopedFind(MatchModel, tenantId, { tournamentId: id }).select({ _id: 1 })
    ).map((entry) => entry._id);

    if (matchIds.length > 0) {
      const [inningsExists, scoreEventExists] = await Promise.all([
        InningsModel.exists({ tenantId, matchId: { $in: matchIds } }),
        ScoreEventModel.exists({ tenantId, matchId: { $in: matchIds } })
      ]);

      if (inningsExists || scoreEventExists) {
        throw new AppError(
          'Tournament format and over configuration are locked after score data exists.',
          409,
          'tournament.config_locked'
        );
      }
    }
  }

  const nextType = updates.type ?? tournament.type;
  const nextQualificationCount =
    updates.rules?.qualificationCount ?? tournament.rules?.qualificationCount;
  // When switching away from LEAGUE_KNOCKOUT, an existing stored qualificationCount
  // should not block the type change unless user explicitly sends it in this PATCH.
  const qualificationToValidate =
    nextType === 'LEAGUE_KNOCKOUT' ? nextQualificationCount : updates.rules?.qualificationCount;
  validateTournamentConfig(nextType, qualificationToValidate);

  if (nextType === 'LEAGUE_KNOCKOUT' && nextQualificationCount !== undefined) {
    const teamCount = await scopedFind(TeamModel, tenantId, { tournamentId: id }).countDocuments();
    if (nextQualificationCount > teamCount) {
      throw new AppError(
        'qualificationCount cannot exceed registered teams.',
        400,
        'tournament.invalid_rules',
        {
          qualificationCount: {
            min: 2,
            max: teamCount,
            reason: 'cannot exceed registered teams'
          }
        }
      );
    }
  }

  if (updates.name !== undefined) tournament.name = updates.name;
  if (updates.location !== undefined) tournament.location = updates.location ?? undefined;
  if (updates.startDate !== undefined) tournament.startDate = updates.startDate ?? undefined;
  if (updates.endDate !== undefined) tournament.endDate = updates.endDate ?? undefined;
  if (updates.type !== undefined) tournament.type = updates.type;
  if (updates.oversPerInnings !== undefined) tournament.oversPerInnings = updates.oversPerInnings;
  if (updates.ballsPerOver !== undefined) tournament.ballsPerOver = updates.ballsPerOver;
  if (updates.status !== undefined) tournament.status = updates.status;
  if (updates.rules !== undefined) {
    tournament.rules = {
      points: {
        win: updates.rules.points?.win ?? tournament.rules?.points?.win ?? 2,
        tie: updates.rules.points?.tie ?? tournament.rules?.points?.tie ?? 1,
        noResult: updates.rules.points?.noResult ?? tournament.rules?.points?.noResult ?? 1,
        loss: updates.rules.points?.loss ?? tournament.rules?.points?.loss ?? 0
      },
      qualificationCount:
        updates.rules.qualificationCount ?? tournament.rules?.qualificationCount ?? 4,
      seeding: updates.rules.seeding ?? tournament.rules?.seeding ?? 'STANDARD'
    };
  }
  if (updates.stageStatus !== undefined) {
    tournament.stageStatus = {
      league: updates.stageStatus.league ?? tournament.stageStatus?.league ?? 'PENDING',
      knockout: updates.stageStatus.knockout ?? tournament.stageStatus?.knockout ?? 'PENDING'
    };
  }

  if (updates.status === 'ACTIVE' && tournament.type !== 'KNOCKOUT' && !updates.stageStatus?.league) {
    tournament.stageStatus = {
      league: 'ACTIVE',
      knockout: tournament.stageStatus?.knockout ?? 'PENDING'
    };
  }

  if (updates.status === 'COMPLETED' && !updates.stageStatus) {
    tournament.stageStatus = {
      league: tournament.type === 'KNOCKOUT' ? 'PENDING' : 'COMPLETED',
      knockout: tournament.type === 'LEAGUE' ? 'PENDING' : 'COMPLETED'
    };
  }

  await tournament.save();
  return tournament;
};

export const syncLeagueCompletionStatus = async (tenantId: string, tournamentId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(tournamentId, 'Invalid tournament id.');

  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: tournamentId });
  if (!tournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  if (tournament.type !== 'LEAGUE' && tournament.type !== 'LEAGUE_KNOCKOUT') {
    return tournament;
  }

  const pendingLeagueMatch = await scopedFindOne(MatchModel, tenantId, {
    tournamentId,
    stage: 'LEAGUE',
    status: { $ne: 'COMPLETED' }
  });

  if (pendingLeagueMatch) {
    tournament.stageStatus = {
      league: 'ACTIVE',
      knockout: tournament.stageStatus?.knockout ?? 'PENDING'
    };
    await tournament.save();
    return tournament;
  }

  tournament.stageStatus = {
    league: 'COMPLETED',
    knockout: tournament.type === 'LEAGUE_KNOCKOUT' ? tournament.stageStatus?.knockout ?? 'PENDING' : 'PENDING'
  };

  if (tournament.type === 'LEAGUE') {
    tournament.status = 'COMPLETED';
  }

  await tournament.save();
  return tournament;
};

export const syncKnockoutProgression = async (
  tenantId: string,
  tournamentId: string,
  completedMatchId: string
) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(tournamentId, 'Invalid tournament id.');
  ensureObjectId(completedMatchId, 'Invalid match id.');

  const tournament = await scopedFindOne(TournamentModel, tenantId, { _id: tournamentId });
  if (!tournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  if (tournament.type !== 'KNOCKOUT' && tournament.type !== 'LEAGUE_KNOCKOUT') {
    return { created: 0, stage: null as KnockoutStage | null, roundNumber: null as number | null };
  }

  const completedMatch = await scopedFindOne(MatchModel, tenantId, {
    _id: completedMatchId,
    tournamentId
  });
  if (!completedMatch || !isKnockoutStage(completedMatch.stage)) {
    return { created: 0, stage: null as KnockoutStage | null, roundNumber: null as number | null };
  }

  const stage = completedMatch.stage;
  const roundNumber = completedMatch.roundNumber ?? 1;
  const stageMatches = await scopedFind(MatchModel, tenantId, {
    tournamentId,
    stage,
    roundNumber
  }).sort({ createdAt: 1 });

  if (stageMatches.length === 0 || stageMatches.some((entry) => entry.status !== 'COMPLETED')) {
    tournament.stageStatus = {
      league: tournament.stageStatus?.league ?? (tournament.type === 'KNOCKOUT' ? 'PENDING' : 'COMPLETED'),
      knockout: 'ACTIVE'
    };
    await tournament.save();
    return { created: 0, stage, roundNumber };
  }

  const winnerTeamIds = stageMatches
    .map((entry) => entry.result?.winnerTeamId?.toString())
    .filter((entry): entry is string => Boolean(entry));

  if (winnerTeamIds.length !== stageMatches.length) {
    return { created: 0, stage, roundNumber };
  }

  if (stage === 'FINAL' || winnerTeamIds.length === 1) {
    tournament.status = 'COMPLETED';
    tournament.stageStatus = {
      league: tournament.type === 'KNOCKOUT' ? 'PENDING' : 'COMPLETED',
      knockout: 'COMPLETED'
    };
    await tournament.save();
    return { created: 0, stage, roundNumber };
  }

  const nextStage = resolveNextKnockoutStage(winnerTeamIds.length);
  if (!nextStage) {
    return { created: 0, stage, roundNumber };
  }

  const nextRoundNumber = roundNumber + 1;
  const existingNextRound = await scopedFindOne(MatchModel, tenantId, {
    tournamentId,
    stage: nextStage,
    roundNumber: nextRoundNumber
  });
  if (existingNextRound) {
    return { created: 0, stage: nextStage, roundNumber: nextRoundNumber };
  }

  const matchesToCreate: Array<{
    tenantId: string;
    tournamentId: string;
    teamAId: string;
    teamBId?: string | null;
    stage: KnockoutStage;
    roundNumber: number;
    status: 'SCHEDULED' | 'COMPLETED';
    result?: {
      winnerTeamId?: string;
      isNoResult?: boolean;
    };
  }> = [];

  let index = 0;
  if (winnerTeamIds.length % 2 === 1) {
    matchesToCreate.push({
      tenantId,
      tournamentId,
      teamAId: winnerTeamIds[0],
      teamBId: null,
      stage: nextStage,
      roundNumber: nextRoundNumber,
      status: 'COMPLETED',
      result: {
        winnerTeamId: winnerTeamIds[0],
        isNoResult: false
      }
    });
    index = 1;
  }

  for (let i = index; i < winnerTeamIds.length; i += 2) {
    const teamAId = winnerTeamIds[i];
    const teamBId = winnerTeamIds[i + 1];
    if (!teamAId || !teamBId) break;
    matchesToCreate.push({
      tenantId,
      tournamentId,
      teamAId,
      teamBId,
      stage: nextStage,
      roundNumber: nextRoundNumber,
      status: 'SCHEDULED'
    });
  }

  if (matchesToCreate.length > 0) {
    await MatchModel.insertMany(matchesToCreate);
  }

  tournament.stageStatus = {
    league: tournament.stageStatus?.league ?? (tournament.type === 'KNOCKOUT' ? 'PENDING' : 'COMPLETED'),
    knockout: 'ACTIVE'
  };
  if (tournament.status === 'DRAFT') {
    tournament.status = 'ACTIVE';
  }
  await tournament.save();

  return {
    created: matchesToCreate.length,
    stage: nextStage,
    roundNumber: nextRoundNumber
  };
};

export const deleteTournament = async (tenantId: string, id: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(id, 'Invalid tournament id.');

  const existing = await scopedFindOne(TournamentModel, tenantId, { _id: id });

  if (!existing) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  const [teams, matches] = await Promise.all([
    scopedFind(TeamModel, tenantId, { tournamentId: id }).select({ _id: 1 }),
    scopedFind(MatchModel, tenantId, { tournamentId: id }).select({ _id: 1 })
  ]);

  const teamIds = teams.map((team) => team._id);
  const matchIds = matches.map((match) => match._id);

  const innings = matchIds.length
    ? await scopedFind(InningsModel, tenantId, { matchId: { $in: matchIds } }).select({ _id: 1 })
    : [];
  const inningsIds = innings.map((entry) => entry._id);

  const [
    playersDelete,
    matchPlayersDelete,
    inningsBattersDelete,
    inningsBowlersDelete,
    scoreEventsDelete,
    teamAccessLinksDelete
  ] = await Promise.all([
      teamIds.length
        ? PlayerModel.deleteMany({ tenantId, teamId: { $in: teamIds } })
        : Promise.resolve({ deletedCount: 0 }),
      matchIds.length
        ? MatchPlayerModel.deleteMany({ tenantId, matchId: { $in: matchIds } })
        : Promise.resolve({ deletedCount: 0 }),
      inningsIds.length
        ? InningsBatterModel.deleteMany({ tenantId, inningsId: { $in: inningsIds } })
        : Promise.resolve({ deletedCount: 0 }),
      inningsIds.length
        ? InningsBowlerModel.deleteMany({ tenantId, inningsId: { $in: inningsIds } })
        : Promise.resolve({ deletedCount: 0 }),
      inningsIds.length
        ? ScoreEventModel.deleteMany({ tenantId, inningsId: { $in: inningsIds } })
        : Promise.resolve({ deletedCount: 0 }),
      teamIds.length
        ? TeamAccessLinkModel.deleteMany({ tenantId, teamId: { $in: teamIds } })
        : Promise.resolve({ deletedCount: 0 })
    ]);

  const [inningsDelete, matchesDelete, teamsDelete] = await Promise.all([
    matchIds.length
      ? InningsModel.deleteMany({ tenantId, matchId: { $in: matchIds } })
      : Promise.resolve({ deletedCount: 0 }),
    matchIds.length
      ? MatchModel.deleteMany({ tenantId, _id: { $in: matchIds } })
      : Promise.resolve({ deletedCount: 0 }),
    teamIds.length
      ? TeamModel.deleteMany({ tenantId, _id: { $in: teamIds } })
      : Promise.resolve({ deletedCount: 0 })
  ]);

  await scopedDeleteOne(TournamentModel, tenantId, { _id: id });

  return {
    id,
    deleted: {
      teams: teamsDelete.deletedCount ?? 0,
      players: playersDelete.deletedCount ?? 0,
      matches: matchesDelete.deletedCount ?? 0,
      matchPlayers: matchPlayersDelete.deletedCount ?? 0,
      innings: inningsDelete.deletedCount ?? 0,
      inningsBatters: inningsBattersDelete.deletedCount ?? 0,
      inningsBowlers: inningsBowlersDelete.deletedCount ?? 0,
      scoreEvents: scoreEventsDelete.deletedCount ?? 0,
      teamAccessLinks: teamAccessLinksDelete.deletedCount ?? 0
    }
  };
};

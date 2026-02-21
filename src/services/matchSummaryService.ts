import { isValidObjectId } from 'mongoose';
import { InningsBatterModel } from '../models/inningsBatter';
import { InningsBowlerModel } from '../models/inningsBowler';
import { InningsModel } from '../models/innings';
import { MatchModel } from '../models/match';
import { PlayerModel } from '../models/player';
import { ScoreEventModel } from '../models/scoreEvent';
import { TeamModel } from '../models/team';
import { AppError } from '../utils/appError';
import { scopedFind, scopedFindOne } from '../utils/scopedQuery';

type TeamDto = {
  id: string;
  name: string;
  shortName: string | null;
};

type ExtrasDto = {
  byes: number;
  legByes: number;
  wides: number;
  noBalls: number;
  total: number;
};

type FowDto = {
  wicketNumber: number;
  score: number;
  balls: number;
  overs: string;
  batterName: string | null;
  kind: string | null;
};

type MatchOutcome = 'WIN' | 'TIE' | 'NO_RESULT' | null;

type WicketDetail = {
  batterStatId: string | null;
  batterPlayerId: string | null;
  batterName: string | null;
  kind: string | null;
  bowlerName: string | null;
  fielderName: string | null;
  score: number;
  balls: number;
};

type SnapshotBatter = {
  id?: unknown;
  playerRef?: {
    playerId?: unknown;
    name?: unknown;
  };
};

type SnapshotInnings = {
  runs?: unknown;
  balls?: unknown;
  strikerId?: unknown;
  nonStrikerId?: unknown;
  currentBowlerId?: unknown;
};

type SnapshotEnvelope = {
  innings?: SnapshotInnings;
  batters?: SnapshotBatter[];
};

type EventPayload = {
  extraType?: unknown;
  additionalRuns?: unknown;
  runsWithWicket?: unknown;
  wicketType?: unknown;
  runOutBatsman?: unknown;
  batterName?: unknown;
  bowlerName?: unknown;
  fielderName?: unknown;
};

const ensureObjectId = (id: string, message: string) => {
  if (!isValidObjectId(id)) {
    throw new AppError(message, 400, 'validation.invalid_id');
  }
};

const formatOvers = (balls: number, ballsPerOver: number) => {
  const completedOvers = Math.floor(balls / ballsPerOver);
  const ballsInOver = balls % ballsPerOver;
  return `${completedOvers}.${ballsInOver}`;
};

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
};

const asNumber = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asStringOrNull = (value: unknown) => (typeof value === 'string' ? value : null);

const pluralize = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

const toScoreEventsFilter = (tenantId: string, matchId: string) => ({
  tenantId,
  matchId,
  $and: [
    { $or: [{ isUndone: false }, { isUndone: { $exists: false } }] },
    { $or: [{ undoneAt: null }, { undoneAt: { $exists: false } }] }
  ]
});

const computeExtras = (
  events: Array<{
    type: string;
    payload?: unknown;
  }>
): ExtrasDto => {
  let wides = 0;
  let noBalls = 0;
  let byes = 0;
  let legByes = 0;

  events.forEach((event) => {
    const payload = (asObject(event.payload) ?? {}) as EventPayload;

    if (event.type === 'extra') {
      const extraType = asStringOrNull(payload.extraType);
      const additionalRuns = asNumber(payload.additionalRuns, 0);

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

    if (event.type === 'wicket') {
      const extraType = asStringOrNull(payload.extraType);
      const runsWithWicket = asNumber(payload.runsWithWicket, 0);

      if (extraType === 'wide') {
        wides += 1 + runsWithWicket;
      } else if (extraType === 'noBall') {
        noBalls += 1;
      }
    }
  });

  return {
    byes,
    legByes,
    wides,
    noBalls,
    total: byes + legByes + wides + noBalls
  };
};

const extractDismissedBatter = (beforeSnapshot: unknown, payload: EventPayload) => {
  const snapshot = (asObject(beforeSnapshot) ?? {}) as SnapshotEnvelope;
  const innings = (asObject(snapshot.innings) ?? {}) as SnapshotInnings;
  const batters = Array.isArray(snapshot.batters) ? snapshot.batters : [];

  const wicketType = asStringOrNull(payload.wicketType);
  const runOutBatsman = asStringOrNull(payload.runOutBatsman);

  const fallenSide =
    wicketType === 'runOutStriker' || wicketType === 'runOutNonStriker'
      ? runOutBatsman ?? 'striker'
      : 'striker';

  const batterStatId =
    fallenSide === 'nonStriker'
      ? asStringOrNull(innings.nonStrikerId)
      : asStringOrNull(innings.strikerId);

  if (!batterStatId) {
    return {
      batterStatId: null,
      batterPlayerId: null,
      batterName: asStringOrNull(payload.batterName)
    };
  }

  const batter = batters.find((entry) => asStringOrNull(entry.id) === batterStatId);
  const playerRef = asObject(batter?.playerRef);

  return {
    batterStatId,
    batterPlayerId: asStringOrNull(playerRef?.playerId),
    batterName: asStringOrNull(playerRef?.name) ?? asStringOrNull(payload.batterName)
  };
};

const extractAfterSnapshotScore = (afterSnapshot: unknown) => {
  const snapshot = (asObject(afterSnapshot) ?? {}) as SnapshotEnvelope;
  const innings = (asObject(snapshot.innings) ?? {}) as SnapshotInnings;

  return {
    runs: asNumber(innings.runs, 0),
    balls: asNumber(innings.balls, 0),
    bowlerId: asStringOrNull(innings.currentBowlerId)
  };
};

export const getMatchSummary = async (tenantId: string, matchId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(matchId, 'Invalid match id.');

  const match = await scopedFindOne(MatchModel, tenantId, { _id: matchId }).select({
    _id: 1,
    tournamentId: 1,
    status: 1,
    stage: 1,
    teamAId: 1,
    teamBId: 1,
    oversPerInnings: 1,
    ballsPerOver: 1,
    result: 1,
    secondInningsTarget: 1
  });

  if (!match) {
    throw new AppError('Match not found.', 404, 'match.not_found');
  }

  const inningsList = await scopedFind(InningsModel, tenantId, { matchId })
    .sort({ inningsNumber: 1 })
    .select({
      _id: 1,
      inningsNumber: 1,
      battingTeamId: 1,
      bowlingTeamId: 1,
      runs: 1,
      wickets: 1,
      balls: 1,
      ballsPerOver: 1,
      oversPerInnings: 1
    });

  const inningsIds = inningsList.map((entry) => entry._id.toString());
  const teamIds = new Set<string>();
  teamIds.add(match.teamAId.toString());
  if (match.teamBId) {
    teamIds.add(match.teamBId.toString());
  }

  inningsList.forEach((entry) => {
    teamIds.add(entry.battingTeamId.toString());
    teamIds.add(entry.bowlingTeamId.toString());
  });

  const [teams, batters, bowlers, events] = await Promise.all([
    scopedFind(TeamModel, tenantId, { _id: { $in: [...teamIds] } }).select({
      _id: 1,
      name: 1,
      shortName: 1
    }),
    inningsIds.length > 0
      ? scopedFind(InningsBatterModel, tenantId, { inningsId: { $in: inningsIds } })
          .sort({ createdAt: 1 })
          .select({
            _id: 1,
            inningsId: 1,
            playerRef: 1,
            batterKey: 1,
            runs: 1,
            balls: 1,
            fours: 1,
            sixes: 1,
            isOut: 1,
            outKind: 1,
            position: 1,
            createdAt: 1
          })
      : Promise.resolve([]),
    inningsIds.length > 0
      ? scopedFind(InningsBowlerModel, tenantId, { inningsId: { $in: inningsIds } })
          .sort({ balls: -1, createdAt: 1 })
          .select({
            _id: 1,
            inningsId: 1,
            playerId: 1,
            name: 1,
            balls: 1,
            maidens: 1,
            runsConceded: 1,
            wickets: 1,
            wides: 1,
            noBalls: 1,
            createdAt: 1
          })
      : Promise.resolve([]),
    inningsIds.length > 0
      ? ScoreEventModel.find({
          ...toScoreEventsFilter(tenantId, matchId),
          inningsId: { $in: inningsIds },
        })
          .sort({ inningsId: 1, seq: 1 })
          .select({
            inningsId: 1,
            seq: 1,
            type: 1,
            payload: 1,
            beforeSnapshot: 1,
            afterSnapshot: 1
          })
      : Promise.resolve([])
  ]);

  const teamMap = new Map<string, TeamDto>();
  teams.forEach((team) => {
    teamMap.set(team._id.toString(), {
      id: team._id.toString(),
      name: team.name,
      shortName: team.shortName ?? null
    });
  });

  const safeTeam = (id: string): TeamDto =>
    teamMap.get(id) ?? {
      id,
      name: 'Unknown Team',
      shortName: null
    };

  const battersByInnings = new Map<string, typeof batters>();
  batters.forEach((entry) => {
    const key = entry.inningsId.toString();
    const list = battersByInnings.get(key) ?? [];
    list.push(entry);
    battersByInnings.set(key, list);
  });

  const bowlersByInnings = new Map<string, typeof bowlers>();
  bowlers.forEach((entry) => {
    const key = entry.inningsId.toString();
    const list = bowlersByInnings.get(key) ?? [];
    list.push(entry);
    bowlersByInnings.set(key, list);
  });

  const eventsByInnings = new Map<string, typeof events>();
  events.forEach((entry) => {
    const key = entry.inningsId.toString();
    const list = eventsByInnings.get(key) ?? [];
    list.push(entry);
    eventsByInnings.set(key, list);
  });

  const bowlerIdsFromEvents = new Set<string>();
  events.forEach((event) => {
    const score = extractAfterSnapshotScore(event.afterSnapshot);
    if (score.bowlerId) {
      bowlerIdsFromEvents.add(score.bowlerId);
    }
  });

  const bowlerIdsFromFigures = new Set<string>();
  bowlers.forEach((entry) => bowlerIdsFromFigures.add(entry.playerId.toString()));

  const allBowlerPlayerIds = [...new Set([...bowlerIdsFromEvents, ...bowlerIdsFromFigures])];

  const players = allBowlerPlayerIds.length
    ? await PlayerModel.find({ _id: { $in: allBowlerPlayerIds } }).select({ _id: 1, fullName: 1 })
    : [];

  const playerMap = new Map<string, string>();
  players.forEach((player) => {
    playerMap.set(player._id.toString(), player.fullName);
  });

  const innings = inningsList.map((entry) => {
    const inningsId = entry._id.toString();
    const ballsPerOver = entry.ballsPerOver ?? match.ballsPerOver ?? 6;

    const inningsBatters = [...(battersByInnings.get(inningsId) ?? [])].sort((a, b) => {
      const aPosition = typeof a.position === 'number' ? a.position : Number.MAX_SAFE_INTEGER;
      const bPosition = typeof b.position === 'number' ? b.position : Number.MAX_SAFE_INTEGER;

      if (aPosition !== bPosition) {
        return aPosition - bPosition;
      }

      const aCreated = a.createdAt ? a.createdAt.getTime() : 0;
      const bCreated = b.createdAt ? b.createdAt.getTime() : 0;
      return aCreated - bCreated;
    });

    const inningsBowlers = bowlersByInnings.get(inningsId) ?? [];
    const inningsEvents = eventsByInnings.get(inningsId) ?? [];

    const extras = computeExtras(inningsEvents);

    const wicketEvents = inningsEvents.filter((event) => event.type === 'wicket');

    const wicketDetails: WicketDetail[] = wicketEvents.map((event) => {
      const payload = (asObject(event.payload) ?? {}) as EventPayload;
      const dismissed = extractDismissedBatter(event.beforeSnapshot, payload);
      const score = extractAfterSnapshotScore(event.afterSnapshot);
      const payloadBowlerName = asStringOrNull(payload.bowlerName);
      const payloadFielderName = asStringOrNull(payload.fielderName);

      return {
        batterStatId: dismissed.batterStatId,
        batterPlayerId: dismissed.batterPlayerId,
        batterName: dismissed.batterName,
        kind: asStringOrNull(payload.wicketType),
        bowlerName: payloadBowlerName ?? (score.bowlerId ? playerMap.get(score.bowlerId) ?? null : null),
        fielderName: payloadFielderName,
        score: score.runs,
        balls: score.balls
      };
    });

    const dismissalMap = new Map<string, WicketDetail>();
    wicketDetails.forEach((detail) => {
      if (detail.batterStatId) {
        dismissalMap.set(`stat:${detail.batterStatId}`, detail);
      }

      if (detail.batterPlayerId) {
        dismissalMap.set(`player:${detail.batterPlayerId}`, detail);
      }
    });

    const batting = inningsBatters.map((batter) => {
      const playerId =
        batter.playerRef?.playerId?.toString() ?? batter.batterKey?.playerId?.toString() ?? null;
      const dismissal =
        dismissalMap.get(`stat:${batter._id.toString()}`) ??
        (playerId ? dismissalMap.get(`player:${playerId}`) : undefined);

      const kind = batter.outKind ?? dismissal?.kind ?? null;
      const out = batter.isOut
        ? {
            kind,
            bowlerName: dismissal?.bowlerName ?? null,
            fielderName: dismissal?.fielderName ?? null
          }
        : null;

      return {
        batterId: playerId ?? batter._id.toString(),
        name: batter.playerRef?.name ?? batter.batterKey?.name ?? 'Unknown',
        runs: batter.runs,
        balls: batter.balls,
        fours: batter.fours,
        sixes: batter.sixes,
        sr: batter.balls > 0 ? Number(((batter.runs / batter.balls) * 100).toFixed(2)) : 0,
        isOut: batter.isOut,
        out
      };
    });

    const bowling = inningsBowlers.map((bowler) => {
      const oversNumber = bowler.balls > 0 ? bowler.balls / ballsPerOver : 0;
      return {
        bowlerId: bowler.playerId.toString(),
        name: bowler.name || playerMap.get(bowler.playerId.toString()) || 'Unknown',
        balls: bowler.balls,
        overs: formatOvers(bowler.balls, ballsPerOver),
        maidens: bowler.maidens ?? 0,
        runsConceded: bowler.runsConceded,
        wickets: bowler.wickets,
        wides: bowler.wides,
        noBalls: bowler.noBalls,
        er: oversNumber > 0 ? Number((bowler.runsConceded / oversNumber).toFixed(2)) : 0
      };
    });

    const fallOfWickets: FowDto[] = wicketDetails.map((detail, index) => ({
      wicketNumber: index + 1,
      score: detail.score,
      balls: detail.balls,
      overs: formatOvers(detail.balls, ballsPerOver),
      batterName: detail.batterName,
      kind: detail.kind
    }));

    return {
      inningsId,
      inningsNumber: entry.inningsNumber,
      battingTeam: safeTeam(entry.battingTeamId.toString()),
      bowlingTeam: safeTeam(entry.bowlingTeamId.toString()),
      score: {
        runs: entry.runs,
        wickets: entry.wickets,
        balls: entry.balls,
        overs: formatOvers(entry.balls, ballsPerOver)
      },
      extras,
      batting,
      bowling,
      fallOfWickets
    };
  });

  const secondInnings = inningsList.find((entry) => entry.inningsNumber === 2);
  const rawOutcome = (match.result?.type ?? (match.result?.isNoResult ? 'NO_RESULT' : null)) as MatchOutcome;
  const winnerTeamId = match.result?.winnerTeamId?.toString() ?? null;
  const winnerTeamName = winnerTeamId ? (teamMap.get(winnerTeamId)?.name ?? null) : null;

  let outcome: MatchOutcome = rawOutcome;
  let winByRuns = match.result?.winByRuns ?? null;
  let winByWickets = match.result?.winByWickets ?? match.result?.winByWkts ?? null;

  if (outcome === 'TIE' || outcome === 'NO_RESULT') {
    winByRuns = null;
    winByWickets = null;
  }

  let ballsLeft: number | null = null;
  if (outcome === 'WIN' && winByWickets !== null && secondInnings) {
    const ballsPerOver = secondInnings.ballsPerOver ?? match.ballsPerOver ?? 6;
    const oversPerInnings = secondInnings.oversPerInnings ?? match.oversPerInnings ?? null;
    if (oversPerInnings !== null) {
      const maxBalls = oversPerInnings * ballsPerOver;
      ballsLeft = Math.max(0, maxBalls - secondInnings.balls);
    }
  }

  let message: string | null = null;
  if (outcome === 'WIN' && winnerTeamName) {
    if (winByWickets !== null) {
      message =
        ballsLeft !== null
          ? `${winnerTeamName} won by ${pluralize(winByWickets, 'wicket')} (${pluralize(ballsLeft, 'ball')} left)`
          : `${winnerTeamName} won by ${pluralize(winByWickets, 'wicket')}`;
    } else if (winByRuns !== null) {
      message = `${winnerTeamName} won by ${pluralize(winByRuns, 'run')}`;
    } else {
      message = `${winnerTeamName} won`;
    }
  } else if (outcome === 'TIE') {
    message = 'Match tied';
  } else if (outcome === 'NO_RESULT') {
    message = 'No result';
  }

  const result = {
    outcome,
    winnerTeamId: outcome === 'WIN' ? winnerTeamId : null,
    winnerTeamName: outcome === 'WIN' ? winnerTeamName : null,
    winByRuns: outcome === 'WIN' ? winByRuns : null,
    winByWickets: outcome === 'WIN' ? winByWickets : null,
    ballsLeft: outcome === 'WIN' ? ballsLeft : null,
    ballsRemaining: outcome === 'WIN' ? ballsLeft : null,
    message,
    type: outcome,
    targetRuns: match.result?.targetRuns ?? match.secondInningsTarget ?? null
  };

  return {
    match: {
      id: match._id.toString(),
      tournamentId: match.tournamentId.toString(),
      status: match.status,
      stage: match.stage,
      teamA: safeTeam(match.teamAId.toString()),
      teamB: match.teamBId ? safeTeam(match.teamBId.toString()) : null,
      oversPerInnings: match.oversPerInnings ?? null,
      ballsPerOver: match.ballsPerOver ?? 6,
      result
    },
    innings
  };
};

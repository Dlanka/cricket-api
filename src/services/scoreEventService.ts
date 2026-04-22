/* eslint-disable @typescript-eslint/no-explicit-any */
import { isValidObjectId } from 'mongoose';
import { InningsBatterModel } from '../models/inningsBatter';
import { InningsBowlerModel } from '../models/inningsBowler';
import { InningsModel } from '../models/innings';
import { MatchModel } from '../models/match';
import { MatchPlayerModel } from '../models/matchPlayer';
import { PlayerModel } from '../models/player';
import { ScoreEventModel } from '../models/scoreEvent';
import { TournamentModel } from '../models/tournament';
import { logger } from '../config/logger';
import { AppError } from '../utils/appError';
import { scopedFind, scopedFindOne } from '../utils/scopedQuery';
import { evaluateSecondInningsResult } from './utils/evaluateSecondInningsResult';
import { invalidateCachedMatchScore } from './utils/matchScoreCache';
import { emitMatchScoreRefresh, emitMatchScoreUpdate } from './utils/matchScoreRealtime';
import { invalidateInningsReadCache, invalidateMatchReadCache } from './utils/scoringReadCache';
import { syncKnockoutProgression, syncLeagueCompletionStatus } from './tournamentService';
import { applyStrikeRotationForDelivery } from './utils/strikeRotation';
import { getMatchScore } from './matchService';

type ScoreEventInput = {
  tenantId: string;
  matchId: string;
  createdByUserId: string;
  type: 'run' | 'extra' | 'wicket' | 'swap' | 'retire' | 'undo';
  runs?: 0 | 1 | 2 | 3 | 4 | 6;
  extraType?: 'wide' | 'noBall' | 'byes' | 'legByes' | 'none';
  additionalRuns?: number;
  wicketType?:
    | 'bowled'
    | 'caught'
    | 'lbw'
    | 'stumping'
    | 'hitWicket'
    | 'runOut'
    | 'obstructingField';
  newBatterId?: string;
  newBatterName?: string;
  fielderId?: string;
  runOutBatsman?: 'striker' | 'nonStriker';
  runsWithWicket?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  retiringBatter?: 'striker' | 'nonStriker';
  reason?: string;
};

type Snapshot = {
  innings: {
    runs: number;
    wickets: number;
    balls: number;
    extras: number;
    wides: number;
    noBalls: number;
    byes: number;
    legByes: number;
    status: 'LIVE' | 'COMPLETED';
    strikerId: string;
    nonStrikerId: string;
    currentBowlerId: string;
    currentOver: {
      overNumber: number;
      legalBallsInOver: number;
      balls: Array<{ seq?: number; display: string; isLegal: boolean }>;
    };
  };
  batters: Array<{
    id: string;
    tenantId: string;
    inningsId: string;
    playerRef: { playerId?: string; name: string };
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
    isOut: boolean;
    outKind?: string;
    outFielderId?: string;
    outFielderName?: string;
    outBowlerId?: string;
    outBowlerName?: string;
  }>;
  bowler: {
    id: string;
    tenantId: string;
    inningsId: string;
    playerId: string;
    runsConceded: number;
    balls: number;
    wickets: number;
    foursConceded: number;
    sixesConceded: number;
    wides: number;
    noBalls: number;
  } | null;
};

const ensureObjectId = (id: string, message: string) => {
  if (!isValidObjectId(id)) {
    throw new AppError(message, 400, 'validation.invalid_id');
  }
};

const ensureCurrentOver = (innings: any) => {
  if (!innings.currentOver) {
    innings.currentOver = { overNumber: 0, legalBallsInOver: 0, balls: [] };
  }

  if (!Array.isArray(innings.currentOver.balls)) {
    innings.currentOver.balls = [];
  }
};

const ensureInningsExtras = (innings: any) => {
  innings.extras = Number.isFinite(Number(innings.extras)) ? Number(innings.extras) : 0;
  innings.wides = Number.isFinite(Number(innings.wides)) ? Number(innings.wides) : 0;
  innings.noBalls = Number.isFinite(Number(innings.noBalls)) ? Number(innings.noBalls) : 0;
  innings.byes = Number.isFinite(Number(innings.byes)) ? Number(innings.byes) : 0;
  innings.legByes = Number.isFinite(Number(innings.legByes)) ? Number(innings.legByes) : 0;
};

const getMaxLegalBalls = (innings: any, ballsPerOver: number) =>
  (innings.oversPerInnings ?? 0) * ballsPerOver;
const COMPLETED_MATCH_UNDO_WINDOW_MS = 30 * 60 * 1000;

const isKnockoutStage = (stage?: string | null) =>
  stage === 'R1' || stage === 'QF' || stage === 'SF' || stage === 'FINAL';

const ensureLiveContext = async (
  tenantId: string,
  matchId: string,
  allowCompletedInnings = false,
  includeRosterValidation = true
) => {
  const match = await scopedFindOne(MatchModel, tenantId, { _id: matchId });
  if (!match) throw new AppError('Match not found.', 404, 'match.not_found');
  if (match.status !== 'LIVE') throw new AppError('Match is not live.', 409, 'match.invalid_state');
  if (!match.currentInningsId) {
    throw new AppError('Match has no active innings.', 409, 'innings.not_started');
  }

  const innings = await scopedFindOne(InningsModel, tenantId, {
    _id: match.currentInningsId,
    matchId,
    status: allowCompletedInnings ? { $in: ['LIVE', 'COMPLETED'] } : 'LIVE'
  });

  if (!innings) throw new AppError('Innings not found.', 404, 'innings.not_found');

  ensureCurrentOver(innings);

  let battingIds = new Set<string>();
  let bowlingIds = new Set<string>();

  if (includeRosterValidation) {
    const [battingRoster, bowlingRoster] = await Promise.all([
      scopedFind(MatchPlayerModel, tenantId, {
        matchId,
        teamId: innings.battingTeamId,
        isPlaying: true
      }),
      scopedFind(MatchPlayerModel, tenantId, {
        matchId,
        teamId: innings.bowlingTeamId,
        isPlaying: true
      })
    ]);

    if (battingRoster.length === 0 || bowlingRoster.length === 0) {
      throw new AppError('Roster must exist for both teams.', 400, 'match.roster_missing');
    }

    battingIds = new Set(battingRoster.map((r) => r.playerId.toString()));
    bowlingIds = new Set(bowlingRoster.map((r) => r.playerId.toString()));

    const ensureOnFieldBatter = async (onFieldId: string) => {
      if (battingIds.has(onFieldId)) {
        return;
      }

      const batter = await InningsBatterModel.findOne({
        tenantId,
        inningsId: innings._id,
        $or: [{ _id: onFieldId }, { 'playerRef.playerId': onFieldId }, { 'batterKey.playerId': onFieldId }]
      });
      if (!batter) {
        throw new AppError('On-field batter must be in playing XI.', 400, 'score.batter_invalid');
      }
    };

    await Promise.all([
      ensureOnFieldBatter(innings.strikerId.toString()),
      ensureOnFieldBatter(innings.nonStrikerId.toString())
    ]);

    if (!bowlingIds.has(innings.currentBowlerId.toString())) {
      throw new AppError('Current bowler must be in playing XI.', 400, 'score.bowler_invalid');
    }
  }

  return {
    match,
    innings,
    // Match-level/innings-level override must drive legal-ball and over-end logic.
    ballsPerOver: innings.ballsPerOver ?? match.ballsPerOver ?? 6,
    battingIds,
    bowlingIds
  };
};

const resolveBatter = async (tenantId: string, inningsId: string, onFieldId: string) => {
  let batter = await InningsBatterModel.findOne({
    tenantId,
    inningsId,
    $or: [{ _id: onFieldId }, { 'playerRef.playerId': onFieldId }]
  });

  if (batter) return batter;

  const player = isValidObjectId(onFieldId) ? await PlayerModel.findById(onFieldId) : null;
  const name = player?.fullName;

  if (!name) {
    throw new AppError('Unable to resolve batter.', 400, 'score.batter_invalid');
  }

  batter = await InningsBatterModel.create({
    tenantId,
    inningsId,
    batterKey: { playerId: player?._id, name },
    playerRef: { playerId: player?._id, name },
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    isOut: false
  });

  return batter;
};

const resolveBowler = async (tenantId: string, inningsId: string, playerId: string) => {
  let bowler = await InningsBowlerModel.findOne({ tenantId, inningsId, playerId });

  if (bowler) return bowler;

  const player = isValidObjectId(playerId) ? await PlayerModel.findById(playerId) : null;

  bowler = await InningsBowlerModel.create({
    tenantId,
    inningsId,
    playerId,
    name: player?.fullName ?? '',
    runsConceded: 0,
    balls: 0,
    wickets: 0,
    foursConceded: 0,
    sixesConceded: 0,
    wides: 0,
    noBalls: 0
  });

  return bowler;
};

const resolveOnFieldParticipants = async (
  tenantId: string,
  inningsId: string,
  strikerId: string,
  nonStrikerId: string,
  bowlerId: string
) => {
  const batterIds = [strikerId, nonStrikerId];
  const [batterCandidates, bowler] = await Promise.all([
    InningsBatterModel.find({
      tenantId,
      inningsId,
      $or: [
        { _id: { $in: batterIds } },
        { 'playerRef.playerId': { $in: batterIds } },
        { 'batterKey.playerId': { $in: batterIds } }
      ]
    }),
    resolveBowler(tenantId, inningsId, bowlerId)
  ]);

  const findBatter = (onFieldId: string) =>
    batterCandidates.find(
      (entry) =>
        entry._id.toString() === onFieldId ||
        entry.playerRef?.playerId?.toString() === onFieldId ||
        entry.batterKey?.playerId?.toString() === onFieldId
    );

  const striker = findBatter(strikerId) ?? (await resolveBatter(tenantId, inningsId, strikerId));
  const nonStriker =
    findBatter(nonStrikerId) ?? (await resolveBatter(tenantId, inningsId, nonStrikerId));

  return { striker, nonStriker, bowler };
};

const pushBall = (
  innings: any,
  seq: number,
  display: string,
  isLegal: boolean,
  ballsPerOver: number
) => {
  ensureCurrentOver(innings);
  const legalBallsBeforeThisEvent = Math.max(0, innings.balls - (isLegal ? 1 : 0));
  const derivedOverNumber = Math.floor(legalBallsBeforeThisEvent / ballsPerOver);
  const derivedLegalBallsInOver = legalBallsBeforeThisEvent % ballsPerOver;

  const parsedOverNumber = Number(innings.currentOver.overNumber);
  innings.currentOver.overNumber = Number.isFinite(parsedOverNumber) && parsedOverNumber >= 0
    ? parsedOverNumber
    : derivedOverNumber;

  const parsedLegalBalls = Number(innings.currentOver.legalBallsInOver);
  innings.currentOver.legalBallsInOver =
    Number.isFinite(parsedLegalBalls) &&
    parsedLegalBalls >= 0 &&
    parsedLegalBalls < ballsPerOver
      ? parsedLegalBalls
      : derivedLegalBallsInOver;

  innings.currentOver.balls.push({ seq, display, isLegal });

  let overEnded = false;
  if (isLegal) {
    innings.currentOver.legalBallsInOver += 1;
    if (innings.currentOver.legalBallsInOver >= ballsPerOver) {
      innings.currentOver.overNumber += 1;
      innings.currentOver.legalBallsInOver = 0;
      innings.currentOver.balls = [];
      overEnded = true;
    }
  }

  return overEnded;
};

const swapStrike = (innings: any) => {
  const current = innings.strikerId;
  innings.strikerId = innings.nonStrikerId;
  innings.nonStrikerId = current;
};

const snapshotBatter = (entry: any) => ({
  id: entry._id.toString(),
  tenantId: entry.tenantId.toString(),
  inningsId: entry.inningsId.toString(),
  playerRef: {
    playerId: entry.playerRef?.playerId?.toString(),
    name: entry.playerRef?.name ?? ''
  },
  runs: entry.runs,
  balls: entry.balls,
  fours: entry.fours,
  sixes: entry.sixes,
  isOut: entry.isOut,
  outKind: entry.outKind,
  outFielderId: entry.outFielderId?.toString(),
  outFielderName: entry.outFielderName,
  outBowlerId: entry.outBowlerId?.toString(),
  outBowlerName: entry.outBowlerName
});

const snapshotBowler = (entry: any) => ({
  id: entry._id.toString(),
  tenantId: entry.tenantId.toString(),
  inningsId: entry.inningsId.toString(),
  playerId: entry.playerId.toString(),
  runsConceded: entry.runsConceded,
  balls: entry.balls,
  wickets: entry.wickets,
  foursConceded: entry.foursConceded,
  sixesConceded: entry.sixesConceded,
  wides: entry.wides,
  noBalls: entry.noBalls
});

const buildSnapshotFromState = (
  innings: any,
  batters: any[],
  bowler: any | null
): Snapshot => {
  ensureCurrentOver(innings);
  ensureInningsExtras(innings);

  const uniqueBatters = [
    ...new Map(
      batters
        .filter((entry) => entry && entry._id)
        .map((entry) => [entry._id.toString(), entry])
    ).values()
  ];

  return {
    innings: {
      runs: innings.runs,
      wickets: innings.wickets,
      balls: innings.balls,
      extras: innings.extras ?? 0,
      wides: innings.wides ?? 0,
      noBalls: innings.noBalls ?? 0,
      byes: innings.byes ?? 0,
      legByes: innings.legByes ?? 0,
      status: innings.status,
      strikerId: innings.strikerId.toString(),
      nonStrikerId: innings.nonStrikerId.toString(),
      currentBowlerId: innings.currentBowlerId.toString(),
      currentOver: {
        overNumber: innings.currentOver.overNumber,
        legalBallsInOver: innings.currentOver.legalBallsInOver,
        balls: innings.currentOver.balls.map((b: any) => ({
          display: b.display,
          seq: b.seq,
          isLegal: b.isLegal
        }))
      }
    },
    batters: uniqueBatters.map(snapshotBatter),
    bowler: bowler ? snapshotBowler(bowler) : null
  };
};

const restoreSnapshot = async (tenantId: string, innings: any, snapshot: Snapshot) => {
  innings.runs = snapshot.innings.runs;
  innings.wickets = snapshot.innings.wickets;
  innings.balls = snapshot.innings.balls;
  innings.extras = snapshot.innings.extras ?? 0;
  innings.wides = snapshot.innings.wides ?? 0;
  innings.noBalls = snapshot.innings.noBalls ?? 0;
  innings.byes = snapshot.innings.byes ?? 0;
  innings.legByes = snapshot.innings.legByes ?? 0;
  innings.status = snapshot.innings.status;
  innings.strikerId = snapshot.innings.strikerId;
  innings.nonStrikerId = snapshot.innings.nonStrikerId;
  innings.currentBowlerId = snapshot.innings.currentBowlerId;
  innings.currentOver = {
    overNumber: snapshot.innings.currentOver.overNumber,
    legalBallsInOver: snapshot.innings.currentOver.legalBallsInOver,
    balls: snapshot.innings.currentOver.balls
  };

  if (snapshot.batters.length > 0) {
    const batterOps = snapshot.batters.map((b) => ({
        updateOne: {
          filter: { _id: b.id, tenantId, inningsId: innings._id },
          update: {
            $set: {
              tenantId,
              inningsId: innings._id,
              batterKey: { playerId: b.playerRef.playerId, name: b.playerRef.name },
              playerRef: { playerId: b.playerRef.playerId, name: b.playerRef.name },
              runs: b.runs,
              balls: b.balls,
              fours: b.fours,
              sixes: b.sixes,
              isOut: b.isOut,
              outKind: b.outKind,
              outFielderId: b.outFielderId,
              outFielderName: b.outFielderName,
              outBowlerId: b.outBowlerId,
              outBowlerName: b.outBowlerName
            }
          },
          upsert: true
        }
      })) as any;
    await InningsBatterModel.bulkWrite(batterOps);
  }

  if (snapshot.bowler) {
    await InningsBowlerModel.updateOne(
      { _id: snapshot.bowler.id, tenantId, inningsId: innings._id },
      {
        $set: {
          tenantId,
          inningsId: innings._id,
          playerId: snapshot.bowler.playerId,
          runsConceded: snapshot.bowler.runsConceded,
          balls: snapshot.bowler.balls,
          wickets: snapshot.bowler.wickets,
          foursConceded: snapshot.bowler.foursConceded,
          sixesConceded: snapshot.bowler.sixesConceded,
          wides: snapshot.bowler.wides,
          noBalls: snapshot.bowler.noBalls
        }
      },
      { upsert: true }
    );
  }
};

const buildPayload = (input: ScoreEventInput, createdBatterStatId?: string) => {
  const payload: Record<string, unknown> = { type: input.type };

  if (input.type === 'run') payload.runs = input.runs;

  if (input.type === 'extra') {
    payload.extraType = input.extraType;
    payload.additionalRuns = input.additionalRuns ?? 0;
  }

  if (input.type === 'wicket') {
    payload.wicketType = input.wicketType;
    payload.extraType = input.extraType ?? 'none';
    payload.newBatterId = input.newBatterId;
    payload.newBatterName = input.newBatterName;
    payload.fielderId = input.fielderId;
    payload.runOutBatsman = input.runOutBatsman;
    payload.runsWithWicket = input.runsWithWicket ?? 0;
  }

  if (input.type === 'retire') {
    payload.retiringBatter = input.retiringBatter;
    payload.newBatterId = input.newBatterId;
    payload.newBatterName = input.newBatterName;
    payload.reason = input.reason;
  }

  if (createdBatterStatId) {
    payload.createdBatterStatId = createdBatterStatId;
  }

  return payload;
};

const buildEventMeta = (input: ScoreEventInput) => {
  if (input.type === 'run') {
    return { isLegal: true, summaryDisplay: String(input.runs ?? 0) };
  }

  if (input.type === 'extra') {
    const additionalRuns = input.additionalRuns ?? 0;

    if (input.extraType === 'wide') {
      return {
        isLegal: false,
        summaryDisplay: additionalRuns > 0 ? `Wd+${additionalRuns}` : 'Wd'
      };
    }

    if (input.extraType === 'noBall') {
      return {
        isLegal: false,
        summaryDisplay: additionalRuns > 0 ? `Nb+${additionalRuns}` : 'Nb'
      };
    }

    if (input.extraType === 'byes') {
      return { isLegal: true, summaryDisplay: `B${additionalRuns}` };
    }

    return { isLegal: true, summaryDisplay: `Lb${additionalRuns}` };
  }

  if (input.type === 'wicket') {
    const extraType = input.extraType ?? 'none';
    const runsWithWicket = input.runsWithWicket ?? 0;
    if (extraType === 'wide') {
      return {
        isLegal: false,
        summaryDisplay: runsWithWicket > 0 ? `Wd+${runsWithWicket}+W` : 'Wd+W'
      };
    }

    if (extraType === 'noBall') {
      return {
        isLegal: false,
        summaryDisplay: runsWithWicket > 0 ? `Nb+${runsWithWicket}+W` : 'Nb+W'
      };
    }

    return {
      isLegal: true,
      summaryDisplay: runsWithWicket > 0 ? `W+${runsWithWicket}` : 'W'
    };
  }

  if (input.type === 'swap') {
    return { isLegal: false, summaryDisplay: 'Swap' };
  }

  if (input.type === 'retire') {
    return { isLegal: false, summaryDisplay: 'Retire' };
  }

  return { isLegal: false, summaryDisplay: 'Undo' };
};

const createNamedBatter = async (tenantId: string, inningsId: string, name: string) =>
  InningsBatterModel.create({
    tenantId,
    inningsId,
    batterKey: { name },
    playerRef: { name },
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    isOut: false
  });

const createBatterFromPlayerId = async (
  tenantId: string,
  inningsId: string,
  playerId: string,
  battingIds: Set<string>
) => {
  ensureObjectId(playerId, 'Invalid batter id.');

  if (!battingIds.has(playerId)) {
    throw new AppError('Next batter must be from batting playing XI.', 400, 'score.batter_invalid');
  }

  const existing = await InningsBatterModel.findOne({
    tenantId,
    inningsId,
    'playerRef.playerId': playerId
  });

  if (existing) {
    if (existing.isOut) {
      throw new AppError('Selected batter is already out.', 400, 'score.batter_invalid');
    }
    return existing;
  }

  const player = await PlayerModel.findById(playerId);
  if (!player) {
    throw new AppError('Player not found.', 404, 'player.not_found');
  }

  return InningsBatterModel.create({
    tenantId,
    inningsId,
    batterKey: { playerId: player._id, name: player.fullName },
    playerRef: { playerId: player._id, name: player.fullName },
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    isOut: false
  });
};

const createNextBatter = async (
  tenantId: string,
  inningsId: string,
  battingIds: Set<string>,
  newBatterId?: string,
  newBatterName?: string
) => {
  if (newBatterId) {
    return createBatterFromPlayerId(tenantId, inningsId, newBatterId, battingIds);
  }

  return createNamedBatter(tenantId, inningsId, newBatterName as string);
};

const applyUndo = async (input: ScoreEventInput) => {
  const startedAt = Date.now();
  const phase = {
    loadMs: 0,
    restoreMs: 0,
    saveMs: 0
  };
  const match = await scopedFindOne(MatchModel, input.tenantId, { _id: input.matchId });

  if (!match) {
    throw new AppError('Match not found.', 404, 'match.not_found');
  }
  if (match.status !== 'LIVE' && match.status !== 'COMPLETED') {
    throw new AppError('Match is not live.', 409, 'match.invalid_state');
  }

  if (match.status === 'COMPLETED' && isKnockoutStage(match.stage)) {
    const stageRank: Record<'R1' | 'QF' | 'SF' | 'FINAL', number> = {
      R1: 1,
      QF: 2,
      SF: 3,
      FINAL: 4
    };
    const thisRound = match.roundNumber ?? 1;
    const thisStageRank = stageRank[match.stage];
    const progressedKnockoutMatches = await scopedFind(MatchModel, input.tenantId, {
      tournamentId: match.tournamentId,
      _id: { $ne: match._id },
      stage: { $in: ['R1', 'QF', 'SF', 'FINAL'] },
      status: { $in: ['LIVE', 'COMPLETED'] }
    }).select({ stage: 1, roundNumber: 1 });

    const hasDownstreamProgress = progressedKnockoutMatches.some((entry) => {
      if (!isKnockoutStage(entry.stage)) return false;
      const otherRound = entry.roundNumber ?? 1;
      const otherStageRank = stageRank[entry.stage];
      return otherRound > thisRound || (otherRound === thisRound && otherStageRank > thisStageRank);
    });

    if (hasDownstreamProgress) {
      throw new AppError(
        'Undo is blocked because downstream knockout matches already started.',
        409,
        'score.undo_blocked'
      );
    }
  }

  const target = await ScoreEventModel.findOne({
    tenantId: input.tenantId,
    matchId: input.matchId,
    type: { $ne: 'undo' },
    isUndone: false
  }).sort({ createdAt: -1, seq: -1 });

  if (!target) {
    throw new AppError('No event available to undo.', 409, 'score.undo_empty');
  }

  if (
    match.status === 'COMPLETED' &&
    Date.now() - new Date(target.createdAt).getTime() > COMPLETED_MATCH_UNDO_WINDOW_MS
  ) {
    throw new AppError('Undo window elapsed for completed match.', 409, 'score.undo_window_elapsed', {
      maxUndoWindowMs: COMPLETED_MATCH_UNDO_WINDOW_MS
    });
  }

  const innings = await scopedFindOne(InningsModel, input.tenantId, {
    _id: target.inningsId,
    matchId: input.matchId,
    status: { $in: ['LIVE', 'COMPLETED'] }
  });
  if (!innings) {
    throw new AppError('Innings not found.', 404, 'innings.not_found');
  }
  const inningsTournament = await scopedFindOne(TournamentModel, input.tenantId, {
    _id: match.tournamentId
  });
  if (!inningsTournament) {
    throw new AppError('Tournament not found.', 404, 'tournament.not_found');
  }

  const context = {
    match,
    innings,
    tournament: inningsTournament,
    ballsPerOver: innings.ballsPerOver ?? inningsTournament.ballsPerOver ?? 6
  };

  const before = target.beforeSnapshot as Snapshot;
  const after = target.afterSnapshot as Snapshot;
  phase.loadMs = Date.now() - startedAt;

  await restoreSnapshot(input.tenantId, context.innings, before);

  const createdBatterStatId = (target.payload as { createdBatterStatId?: string })?.createdBatterStatId;
  if (createdBatterStatId && !before.batters.some((b) => b.id === createdBatterStatId)) {
    const created = await InningsBatterModel.findOne({
      _id: createdBatterStatId,
      tenantId: input.tenantId
    }).select({ runs: 1, balls: 1, fours: 1, sixes: 1, isOut: 1 });

    if (
      created &&
      created.runs === 0 &&
      created.balls === 0 &&
      created.fours === 0 &&
      created.sixes === 0 &&
      !created.isOut
    ) {
      await created.deleteOne();
    }
  }
  phase.restoreMs = Date.now() - startedAt - phase.loadMs;

  target.isUndone = true;
  target.undoneAt = new Date();
  target.undoneByUserId = input.createdByUserId;

  context.innings.eventSeq += 1;
  context.innings.lastSeq = context.innings.eventSeq;

  if (before.innings.status === 'LIVE') {
    context.match.status = 'LIVE';
    context.match.currentInningsId = context.innings._id;
    if (context.match.result) {
      context.match.result = {
        ...(context.match.result ?? {}),
        type: undefined,
        winnerTeamId: undefined,
        winByRuns: undefined,
        winByWickets: undefined,
        winByWkts: undefined
      };
    }
    if (context.match.phase === 'SUPER_OVER') {
      context.match.superOverStatus = 'LIVE';
      context.match.superOverTie = false;
      context.match.superOverWinnerTeamId = undefined;
    } else {
      context.match.hasSuperOver = false;
      context.match.superOverStatus = undefined;
      context.match.superOverTie = false;
      context.match.superOverWinnerTeamId = undefined;
      context.match.superOverSetup = undefined;
    }
  }

  await Promise.all([
    target.save(),
    context.innings.save(),
    typeof (context.match as { isModified?: () => boolean }).isModified === 'function' &&
    context.match.isModified()
      ? context.match.save()
      : Promise.resolve()
  ]);

  const undoEvent = await ScoreEventModel.create({
    tenantId: input.tenantId,
    matchId: input.matchId,
    inningsId: context.innings._id,
    seq: context.innings.eventSeq,
    type: 'undo',
    isLegal: false,
    summaryDisplay: 'Undo',
    payload: {
      type: 'undo',
      targetEventId: target._id.toString(),
      targetSeq: target.seq
    },
    // For undo of latest event, current state should be target.afterSnapshot.
    // Reusing avoids an additional read-heavy snapshot capture in hot path.
    beforeSnapshot: after,
    afterSnapshot: before,
    createdByUserId: input.createdByUserId
  });
  phase.saveMs = Date.now() - startedAt - phase.loadMs - phase.restoreMs;

  invalidateCachedMatchScore(input.tenantId, input.matchId);
  invalidateMatchReadCache(input.tenantId, input.matchId);
  invalidateInningsReadCache(input.tenantId, context.innings._id.toString());
  emitMatchScoreRefresh(input.tenantId, input.matchId);
  emitLiveScoreUpdateAsync(input.tenantId, input.matchId);

  const durationMs = Date.now() - startedAt;
  if (durationMs > 1200) {
    logger.warn(
      {
        tenantId: input.tenantId,
        matchId: input.matchId,
        eventType: input.type,
        durationMs,
        phases: phase
      },
      'Slow score-event processing'
    );
  }

  return {
    matchId: input.matchId,
    inningsId: context.innings._id.toString(),
    inningsCompleted: context.innings.status === 'COMPLETED',
    isMatchCompleted: context.match.status === 'COMPLETED',
    event: {
      id: undoEvent._id.toString(),
      type: undoEvent.type,
      seq: undoEvent.seq
    }
  };
};

const shouldCreditBowlerWicket = (wicketType: string) =>
  !['runOut', 'stumping', 'hitWicket', 'obstructingField'].includes(
    wicketType
  );

const validateWicketExtraCombination = (wicketType: string, extraType: string) => {
  if (extraType === 'none') {
    return;
  }

  const wideAllowed = new Set([
    'runOut',
    'stumping',
    'hitWicket',
    'obstructingField'
  ]);

  const noBallAllowed = new Set(['runOut', 'obstructingField']);

  if (extraType === 'wide' && !wideAllowed.has(wicketType)) {
    throw new AppError('Invalid wicket type for wide delivery.', 400, 'score.wicket_extra_invalid');
  }

  if (extraType === 'noBall' && !noBallAllowed.has(wicketType)) {
    throw new AppError('Invalid wicket type for no-ball delivery.', 400, 'score.wicket_extra_invalid');
  }
};

const emitLiveScoreUpdateAsync = (tenantId: string, matchId: string) => {
  void (async () => {
    try {
      const liveScore = await getMatchScore(tenantId, matchId);
      emitMatchScoreUpdate(tenantId, matchId, liveScore);
    } catch (error) {
      logger.warn(
        { err: error, tenantId, matchId },
        'Unable to emit async score:update payload after score-event'
      );
    }
  })();
};

const runPostMatchSyncAsync = (
  tenantId: string,
  tournamentId: string,
  matchId: string,
  shouldSyncKnockout: boolean
) => {
  void (async () => {
    try {
      await Promise.all([
        syncLeagueCompletionStatus(tenantId, tournamentId),
        shouldSyncKnockout
          ? syncKnockoutProgression(tenantId, tournamentId, matchId)
          : Promise.resolve({ created: 0, stage: null, roundNumber: null })
      ]);
    } catch (error) {
      logger.warn(
        { err: error, tenantId, tournamentId, matchId, shouldSyncKnockout },
        'Post-match sync failed after score-event'
      );
    }
  })();
};

const applyEvent = async (input: ScoreEventInput) => {
  const startedAt = Date.now();
  const phase = {
    preMs: 0,
    mutateMs: 0,
    saveMs: 0,
    eventInsertMs: 0,
    postMs: 0
  };
  const context = await ensureLiveContext(input.tenantId, input.matchId, false, false);
  let rosterIds: { battingIds: Set<string>; bowlingIds: Set<string> } | null = null;
  const ensureRosterIds = async () => {
    if (rosterIds) {
      return rosterIds;
    }

    const [battingRoster, bowlingRoster] = await Promise.all([
      scopedFind(MatchPlayerModel, input.tenantId, {
        matchId: input.matchId,
        teamId: context.innings.battingTeamId,
        isPlaying: true
      }).select({ playerId: 1 }),
      scopedFind(MatchPlayerModel, input.tenantId, {
        matchId: input.matchId,
        teamId: context.innings.bowlingTeamId,
        isPlaying: true
      }).select({ playerId: 1 })
    ]);

    if (battingRoster.length === 0 || bowlingRoster.length === 0) {
      throw new AppError('Roster must exist for both teams.', 400, 'match.roster_missing');
    }

    rosterIds = {
      battingIds: new Set(battingRoster.map((entry) => entry.playerId.toString())),
      bowlingIds: new Set(bowlingRoster.map((entry) => entry.playerId.toString()))
    };

    return rosterIds;
  };

  const innings = context.innings;
  ensureInningsExtras(innings);
  const { striker, nonStriker, bowler } = await resolveOnFieldParticipants(
    input.tenantId,
    innings._id.toString(),
    innings.strikerId.toString(),
    innings.nonStrikerId.toString(),
    innings.currentBowlerId.toString()
  );
  const knownBatterDocs = new Map<string, any>();
  const registerBatter = (entry: any | undefined) => {
    if (!entry || !entry._id) return;
    knownBatterDocs.set(entry._id.toString(), entry);
    const playerRefId = entry.playerRef?.playerId?.toString();
    if (playerRefId) {
      knownBatterDocs.set(playerRefId, entry);
    }
    const batterKeyPlayerId = entry.batterKey?.playerId?.toString();
    if (batterKeyPlayerId) {
      knownBatterDocs.set(batterKeyPlayerId, entry);
    }
  };
  registerBatter(striker);
  registerBatter(nonStriker);
  const nextSeq = innings.eventSeq + 1;
  const maxLegalBalls = getMaxLegalBalls(innings, context.ballsPerOver);

  if (maxLegalBalls > 0 && innings.balls >= maxLegalBalls) {
    innings.status = 'COMPLETED';
    await innings.save();
    throw new AppError('Configured overs are completed.', 409, 'match.overs_completed');
  }

  const beforeSnapshot = buildSnapshotFromState(innings, [striker, nonStriker], bowler);
  phase.preMs = Date.now() - startedAt;

  let createdBatterStatId: string | undefined;
  let createdBatterDoc: any | undefined;
  let matchCompletedNow = false;
  let shouldSyncKnockout = false;

  if (input.type === 'swap') {
    swapStrike(innings);
  }

  if (input.type === 'retire') {
    const { battingIds } = await ensureRosterIds();
    const newBatter = await createNextBatter(
      input.tenantId,
      innings._id.toString(),
      battingIds,
      input.newBatterId,
      input.newBatterName
    );

    if (input.retiringBatter === 'striker') {
      striker.isOut = true;
      striker.outKind = 'retired';
      innings.strikerId = newBatter._id;
    } else {
      nonStriker.isOut = true;
      nonStriker.outKind = 'retired';
      innings.nonStrikerId = newBatter._id;
    }

    createdBatterDoc = newBatter;
    registerBatter(newBatter);
    createdBatterStatId = newBatter._id.toString();
  }

  if (input.type === 'run') {
    const preBallStrikerId = innings.strikerId.toString();
    const preBallNonStrikerId = innings.nonStrikerId.toString();
    const runs = input.runs as number;

    innings.runs += runs;
    innings.balls += 1;

    striker.runs += runs;
    striker.balls += 1;
    if (runs === 4) striker.fours += 1;
    if (runs === 6) striker.sixes += 1;

    bowler.runsConceded += runs;
    bowler.balls += 1;
    if (runs === 4) bowler.foursConceded += 1;
    if (runs === 6) bowler.sixesConceded += 1;

    const overEnded = pushBall(innings, nextSeq, String(runs), true, context.ballsPerOver);
    if (maxLegalBalls > 0 && innings.balls >= maxLegalBalls) {
      innings.status = 'COMPLETED';
    }
    const nextPair = applyStrikeRotationForDelivery({
      strikerId: preBallStrikerId,
      nonStrikerId: preBallNonStrikerId,
      completedRuns: runs,
      overEnded,
      inningsCompleted: innings.status === 'COMPLETED'
    });
    innings.strikerId = nextPair.strikerId as any;
    innings.nonStrikerId = nextPair.nonStrikerId as any;
  }

  if (input.type === 'extra') {
    const preBallStrikerId = innings.strikerId.toString();
    const preBallNonStrikerId = innings.nonStrikerId.toString();
    const extraType = input.extraType as string;
    const additionalRuns = input.additionalRuns ?? 0;

    let totalRuns = additionalRuns;
    let isLegal = true;
    let display = '';

    if (extraType === 'wide') {
      totalRuns = 1 + additionalRuns;
      isLegal = false;
      display = additionalRuns > 0 ? `Wd+${additionalRuns}` : 'Wd';
      bowler.wides += 1;
    }

    if (extraType === 'noBall') {
      totalRuns = 1 + additionalRuns;
      isLegal = false;
      display = additionalRuns > 0 ? `Nb+${additionalRuns}` : 'Nb';
      bowler.noBalls += 1;
    }

    if (extraType === 'byes') {
      totalRuns = additionalRuns;
      isLegal = true;
      display = `B${additionalRuns}`;
    }

    if (extraType === 'legByes') {
      totalRuns = additionalRuns;
      isLegal = true;
      display = `Lb${additionalRuns}`;
    }

    innings.runs += totalRuns;
    bowler.runsConceded += totalRuns;

    if (isLegal) {
      innings.balls += 1;
      bowler.balls += 1;
      striker.balls += 1;
    }

    if (extraType === 'noBall' && additionalRuns > 0) {
      striker.runs += additionalRuns;
      if (additionalRuns === 4) striker.fours += 1;
      if (additionalRuns === 6) striker.sixes += 1;
    }
    if (extraType === 'wide') {
      innings.wides += totalRuns;
      innings.extras += totalRuns;
    } else if (extraType === 'noBall') {
      innings.noBalls += 1;
      innings.extras += 1;
    } else if (extraType === 'byes') {
      innings.byes += additionalRuns;
      innings.extras += additionalRuns;
    } else if (extraType === 'legByes') {
      innings.legByes += additionalRuns;
      innings.extras += additionalRuns;
    }

    const rotationRuns =
      extraType === 'wide' || extraType === 'noBall' ? additionalRuns : totalRuns;
    const overEnded = pushBall(innings, nextSeq, display, isLegal, context.ballsPerOver);
    if (isLegal && maxLegalBalls > 0 && innings.balls >= maxLegalBalls) {
      innings.status = 'COMPLETED';
    }
    const nextPair = applyStrikeRotationForDelivery({
      strikerId: preBallStrikerId,
      nonStrikerId: preBallNonStrikerId,
      completedRuns: rotationRuns,
      overEnded,
      inningsCompleted: innings.status === 'COMPLETED'
    });
    innings.strikerId = nextPair.strikerId as any;
    innings.nonStrikerId = nextPair.nonStrikerId as any;
  }

  if (input.type === 'wicket') {
    const wicketType = input.wicketType as string;
    const wicketExtraType = input.extraType ?? 'none';
    const fielderId = input.fielderId?.trim();
    const runs = input.runsWithWicket ?? 0;
    const nextWickets = innings.wickets + 1;
    const isSuperOverInnings =
      context.match.phase === 'SUPER_OVER' && (innings.inningsNumber === 3 || innings.inningsNumber === 4);
    const { battingIds, bowlingIds } = await ensureRosterIds();
    const maxWickets = isSuperOverInnings ? 2 : Math.max(0, battingIds.size - 1);
    const inningsEndsOnWicket = maxWickets > 0 && nextWickets >= maxWickets;
    const isIllegalWicketDelivery = wicketExtraType === 'wide' || wicketExtraType === 'noBall';
    const penaltyRuns = wicketExtraType === 'wide' || wicketExtraType === 'noBall' ? 1 : 0;
    const totalRuns = penaltyRuns + runs;
    // Strike changes only on completed runs between wickets, not on penalty runs.
    const shouldRotateOnRuns = runs % 2 === 1;

    validateWicketExtraCombination(wicketType, wicketExtraType);

    const requiresFielder =
      wicketType === 'caught' ||
      wicketType === 'stumping' ||
      wicketType === 'runOut';

    if (requiresFielder) {
      if (!fielderId) {
        throw new AppError('Fielder is required for this wicket type.', 400, 'score.fielder_required');
      }
      if (!bowlingIds.has(fielderId)) {
        throw new AppError('Fielder must be in bowling playing XI.', 400, 'score.fielder_invalid');
      }
    }

    if (!inningsEndsOnWicket && !input.newBatterId && !input.newBatterName) {
      throw new AppError('New batter is required.', 400, 'score.new_batter_required');
    }

    innings.runs += totalRuns;
    innings.extras += penaltyRuns + (wicketExtraType === 'wide' || wicketExtraType === 'noBall' ? runs : 0);
    innings.wickets = nextWickets;
    if (!isIllegalWicketDelivery) {
      innings.balls += 1;
    }

    let fallen = striker;
    let fallenSide: 'striker' | 'nonStriker' = 'striker';

    if (wicketType === 'runOut') {
      fallenSide = input.runOutBatsman as 'striker' | 'nonStriker';
      fallen = fallenSide === 'striker' ? striker : nonStriker;
    }

    if (!isIllegalWicketDelivery) {
      // Bat runs and ball faced belong to the striker on a legal delivery,
      // even when the non-striker is dismissed via run out.
      striker.runs += runs;
      striker.balls += 1;
      if (runs === 4) striker.fours += 1;
      if (runs === 6) striker.sixes += 1;
    }
    fallen.isOut = true;
    fallen.outKind = wicketType;
    fallen.outBowlerId = bowler.playerId;
    fallen.outBowlerName = bowler.name ?? '';
    if (requiresFielder && fielderId) {
      const fielderPlayer = await PlayerModel.findById(fielderId).select({ fullName: 1 });
      fallen.outFielderId = fielderId as any;
      fallen.outFielderName = fielderPlayer?.fullName ?? '';
    } else {
      fallen.outFielderId = undefined;
      fallen.outFielderName = undefined;
    }

    bowler.runsConceded += totalRuns;
    if (!isIllegalWicketDelivery) {
      bowler.balls += 1;
      if (runs === 4) bowler.foursConceded += 1;
      if (runs === 6) bowler.sixesConceded += 1;
    }
    if (wicketExtraType === 'wide') {
      bowler.wides += 1;
      innings.wides += 1 + runs;
    }
    if (wicketExtraType === 'noBall') {
      bowler.noBalls += 1;
      innings.noBalls += 1 + runs;
    }
    if (shouldCreditBowlerWicket(wicketType)) {
      bowler.wickets += 1;
    }

    if (!inningsEndsOnWicket) {
      const newBatter = await createNextBatter(
        input.tenantId,
        innings._id.toString(),
        battingIds,
        input.newBatterId,
        input.newBatterName
      );
      const survivorId = fallenSide === 'striker' ? nonStriker._id : striker._id;
      const fallenPostSide =
        shouldRotateOnRuns && fallenSide === 'striker'
          ? 'nonStriker'
          : shouldRotateOnRuns && fallenSide === 'nonStriker'
            ? 'striker'
            : fallenSide;

      if (fallenPostSide === 'striker') {
        innings.strikerId = newBatter._id;
        innings.nonStrikerId = survivorId;
      } else {
        innings.strikerId = survivorId;
        innings.nonStrikerId = newBatter._id;
      }

      createdBatterDoc = newBatter;
      registerBatter(newBatter);
      createdBatterStatId = newBatter._id.toString();
    } else {
      innings.status = 'COMPLETED';
    }

    const wicketDisplay =
      wicketExtraType === 'wide'
        ? runs > 0
          ? `Wd+${runs}+W`
          : 'Wd+W'
        : wicketExtraType === 'noBall'
          ? runs > 0
            ? `Nb+${runs}+W`
            : 'Nb+W'
          : runs > 0
            ? `W+${runs}`
            : 'W';

    const overEnded = pushBall(
      innings,
      nextSeq,
      wicketDisplay,
      !isIllegalWicketDelivery,
      context.ballsPerOver
    );
    if (!isIllegalWicketDelivery && maxLegalBalls > 0 && innings.balls >= maxLegalBalls) {
      innings.status = 'COMPLETED';
    }

    if (overEnded && innings.status !== 'COMPLETED') {
      swapStrike(innings);
    }
  }

  const resolveCurrentBatterDoc = async (onFieldId: string) => {
    const found = knownBatterDocs.get(onFieldId);
    if (found) {
      return found;
    }
    const resolved = await resolveBatter(input.tenantId, innings._id.toString(), onFieldId);
    registerBatter(resolved);
    return resolved;
  };

  const currentStriker = await resolveCurrentBatterDoc(innings.strikerId.toString());
  const currentNonStriker = await resolveCurrentBatterDoc(innings.nonStrikerId.toString());

  if (innings.inningsNumber === 2) {
    const innings1 = await scopedFindOne(InningsModel, input.tenantId, {
      matchId: input.matchId,
      inningsNumber: 1
    });

    if (!innings1) {
      throw new AppError('First innings not found.', 404, 'innings.not_found');
    }

    const maxLegalBalls = (innings.oversPerInnings ?? context.match.oversPerInnings ?? 0) * context.ballsPerOver;
    const evaluation = evaluateSecondInningsResult({
      match: context.match,
      innings1,
      innings2: innings,
      maxLegalBalls
    });

    if (evaluation.isMatchCompleted && evaluation.result) {
      innings.status = 'COMPLETED';
      context.match.status = 'COMPLETED';
      context.match.firstInningsRuns = innings1.runs;
      context.match.secondInningsTarget = evaluation.result.targetRuns;
      context.match.result = {
        isNoResult: false,
        ...(context.match.result ?? {}),
        type: evaluation.result.type,
        winnerTeamId: (evaluation.result.winnerTeamId ?? undefined) as any,
        winByRuns: evaluation.result.winByRuns ?? undefined,
        winByWickets: evaluation.result.winByWickets ?? undefined,
        winByWkts: evaluation.result.winByWickets ?? undefined,
        targetRuns: evaluation.result.targetRuns
      };
      context.match.currentInningsId = undefined;
      context.match.phase = 'REGULAR';
      if (evaluation.result.type === 'TIE' && isKnockoutStage(context.match.stage)) {
        context.match.hasSuperOver = true;
        context.match.superOverStatus = 'PENDING';
        context.match.superOverTie = false;
        context.match.superOverWinnerTeamId = undefined;
        context.match.superOverSetup = undefined;
        shouldSyncKnockout = false;
      } else {
        shouldSyncKnockout = true;
      }
      matchCompletedNow = true;
    }
  }

  if (innings.inningsNumber === 3 && innings.status === 'COMPLETED' && context.match.phase === 'SUPER_OVER') {
    const setup = (context.match.superOverSetup ?? {}) as {
      battingFirstTeamId?: string;
      teamA?: { strikerId?: string; nonStrikerId?: string; bowlerId?: string };
      teamB?: { strikerId?: string; nonStrikerId?: string; bowlerId?: string };
    };
    const battingSecondTeamId =
      innings.battingTeamId.toString() === context.match.teamAId.toString()
        ? context.match.teamBId?.toString()
        : context.match.teamAId.toString();
    if (!battingSecondTeamId || !setup.teamA || !setup.teamB) {
      throw new AppError('Super over setup is missing.', 409, 'match.super_over_invalid_state');
    }
    const battingSecondConfig =
      battingSecondTeamId === context.match.teamAId.toString() ? setup.teamA : setup.teamB;
    const bowlingTeamId =
      battingSecondTeamId === context.match.teamAId.toString()
        ? context.match.teamBId?.toString()
        : context.match.teamAId.toString();
    if (
      !bowlingTeamId ||
      !battingSecondConfig.strikerId ||
      !battingSecondConfig.nonStrikerId ||
      !battingSecondConfig.bowlerId
    ) {
      throw new AppError('Super over setup is missing.', 409, 'match.super_over_invalid_state');
    }

    const superOverInnings2 = await InningsModel.create({
      tenantId: input.tenantId,
      matchId: input.matchId,
      inningsNumber: 4,
      battingTeamId: battingSecondTeamId,
      bowlingTeamId,
      strikerId: battingSecondConfig.strikerId,
      nonStrikerId: battingSecondConfig.nonStrikerId,
      currentBowlerId: battingSecondConfig.bowlerId,
      runs: 0,
      wickets: 0,
      balls: 0,
      ballsPerOver: innings.ballsPerOver,
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

    context.match.currentInningsId = superOverInnings2._id;
    context.match.status = 'LIVE';
    context.match.superOverStatus = 'LIVE';
  }

  if (innings.inningsNumber === 4 && innings.status === 'COMPLETED' && context.match.phase === 'SUPER_OVER') {
    const [superOverInnings1, superOverInnings2] = await Promise.all([
      scopedFindOne(InningsModel, input.tenantId, { matchId: input.matchId, inningsNumber: 3 }),
      scopedFindOne(InningsModel, input.tenantId, { matchId: input.matchId, inningsNumber: 4 })
    ]);

    if (!superOverInnings1 || !superOverInnings2) {
      throw new AppError('Super over innings not found.', 404, 'innings.not_found');
    }

    context.match.status = 'COMPLETED';
    context.match.currentInningsId = undefined;
    context.match.superOverStatus = 'COMPLETED';

    if (superOverInnings1.runs === superOverInnings2.runs) {
      context.match.superOverTie = true;
      context.match.result = {
        isNoResult: false,
        ...(context.match.result ?? {}),
        type: 'TIE'
      };
      shouldSyncKnockout = false;
    } else {
      const winnerTeamId =
        superOverInnings1.runs > superOverInnings2.runs
          ? superOverInnings1.battingTeamId.toString()
          : superOverInnings2.battingTeamId.toString();
      context.match.superOverTie = false;
      context.match.superOverWinnerTeamId = winnerTeamId as any;
      context.match.result = {
        isNoResult: false,
        ...(context.match.result ?? {}),
        type: 'WIN',
        winnerTeamId: winnerTeamId as any,
        winByRuns: undefined,
        winByWickets: undefined,
        winByWkts: undefined
      };
      shouldSyncKnockout = true;
    }

    matchCompletedNow = true;
  }
  phase.mutateMs = Date.now() - startedAt - phase.preMs;

  innings.eventSeq += 1;
  innings.lastSeq = innings.eventSeq;
  const saves: Array<Promise<unknown>> = [innings.save()];
  const maybeSaveDoc = (doc: { isModified?: () => boolean; save: () => Promise<unknown> }) => {
    if (typeof doc.isModified === 'function') {
      if (doc.isModified()) {
        saves.push(doc.save());
      }
      return;
    }
    saves.push(doc.save());
  };
  maybeSaveDoc(striker);
  maybeSaveDoc(nonStriker);
  maybeSaveDoc(bowler);
  if (typeof (context.match as { isModified?: () => boolean }).isModified === 'function' && context.match.isModified()) {
    saves.push(context.match.save());
  }

  const saveStartedAt = Date.now();
  await Promise.all(saves);
  phase.saveMs = Date.now() - saveStartedAt;

  if (matchCompletedNow) {
    runPostMatchSyncAsync(
      input.tenantId,
      context.match.tournamentId.toString(),
      context.match._id.toString(),
      shouldSyncKnockout
    );
  }

  const afterSnapshot = buildSnapshotFromState(
    innings,
    [striker, nonStriker, currentStriker, currentNonStriker, createdBatterDoc],
    bowler
  );

  const meta = buildEventMeta(input);

  const eventInsertStartedAt = Date.now();
  const event = await ScoreEventModel.create({
    tenantId: input.tenantId,
    matchId: input.matchId,
    inningsId: innings._id,
    seq: innings.eventSeq,
    type: input.type,
    isLegal: meta.isLegal,
    summaryDisplay: meta.summaryDisplay,
    payload: buildPayload(input, createdBatterStatId),
    beforeSnapshot,
    afterSnapshot,
    createdByUserId: input.createdByUserId
  });
  phase.eventInsertMs = Date.now() - eventInsertStartedAt;

  const postStartedAt = Date.now();
  invalidateCachedMatchScore(input.tenantId, input.matchId);
  invalidateMatchReadCache(input.tenantId, input.matchId);
  invalidateInningsReadCache(input.tenantId, innings._id.toString());
  emitMatchScoreRefresh(input.tenantId, input.matchId);
  emitLiveScoreUpdateAsync(input.tenantId, input.matchId);
  phase.postMs = Date.now() - postStartedAt;

  const durationMs = Date.now() - startedAt;
  if (durationMs > 1200) {
    logger.warn(
      { tenantId: input.tenantId, matchId: input.matchId, eventType: input.type, durationMs, phases: phase },
      'Slow score-event processing'
    );
  }

  return {
    matchId: input.matchId,
    inningsId: innings._id.toString(),
    inningsCompleted: innings.status === 'COMPLETED',
    isMatchCompleted: context.match.status === 'COMPLETED',
    event: {
      id: event._id.toString(),
      type: event.type,
      seq: event.seq
    }
  };
};

export const scoreMatchEvent = async (input: ScoreEventInput) => {
  ensureObjectId(input.tenantId, 'Invalid tenant id.');
  ensureObjectId(input.matchId, 'Invalid match id.');

  if (!input.createdByUserId) {
    throw new AppError('Missing user context.', 401, 'auth.invalid_token');
  }

  if (input.type === 'undo') {
    return applyUndo(input);
  }

  return applyEvent(input);
};



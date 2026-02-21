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
import { AppError } from '../utils/appError';
import { scopedFind, scopedFindOne } from '../utils/scopedQuery';
import { evaluateSecondInningsResult } from './utils/evaluateSecondInningsResult';
import { syncKnockoutProgression, syncLeagueCompletionStatus } from './tournamentService';

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
    | 'runOutStriker'
    | 'runOutNonStriker'
    | 'obstructingField';
  newBatterId?: string;
  newBatterName?: string;
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

const formatOvers = (balls: number, ballsPerOver: number) => {
  const completedOvers = Math.floor(balls / ballsPerOver);
  const ballsInOver = balls % ballsPerOver;
  return `${completedOvers}.${ballsInOver}`;
};

const ensureCurrentOver = (innings: any) => {
  if (!innings.currentOver) {
    innings.currentOver = { overNumber: 0, legalBallsInOver: 0, balls: [] };
  }

  if (!Array.isArray(innings.currentOver.balls)) {
    innings.currentOver.balls = [];
  }
};

const getMaxLegalBalls = (innings: any, ballsPerOver: number) =>
  (innings.oversPerInnings ?? 0) * ballsPerOver;

const ensureLiveContext = async (
  tenantId: string,
  matchId: string,
  allowCompletedInnings = false
) => {
  const match = await scopedFindOne(MatchModel, tenantId, { _id: matchId });
  if (!match) throw new AppError('Match not found.', 404, 'match.not_found');
  if (match.status !== 'LIVE') throw new AppError('Match is not live.', 409, 'match.invalid_state');
  if (!match.currentInningsId) {
    throw new AppError('Match has no active innings.', 409, 'innings.not_started');
  }

  const [innings, tournament] = await Promise.all([
    scopedFindOne(InningsModel, tenantId, {
      _id: match.currentInningsId,
      matchId,
      status: allowCompletedInnings ? { $in: ['LIVE', 'COMPLETED'] } : 'LIVE'
    }),
    scopedFindOne(TournamentModel, tenantId, { _id: match.tournamentId })
  ]);

  if (!innings) throw new AppError('Innings not found.', 404, 'innings.not_found');
  if (!tournament) throw new AppError('Tournament not found.', 404, 'tournament.not_found');

  ensureCurrentOver(innings);

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

  const battingIds = new Set(battingRoster.map((r) => r.playerId.toString()));
  const bowlingIds = new Set(bowlingRoster.map((r) => r.playerId.toString()));

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

  return {
    match,
    innings,
    tournament,
    // Match-level/innings-level override must drive legal-ball and over-end logic.
    ballsPerOver: innings.ballsPerOver ?? tournament.ballsPerOver ?? 6,
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

const pushBall = (
  innings: any,
  seq: number,
  display: string,
  isLegal: boolean,
  ballsPerOver: number
) => {
  ensureCurrentOver(innings);
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
  outKind: entry.outKind
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

const captureSnapshot = async (
  innings: any,
  batterIds: string[],
  bowlerStatsId?: string
): Promise<Snapshot> => {
  const uniqueIds = [...new Set(batterIds.filter(Boolean))];
  const batters = uniqueIds.length ? await InningsBatterModel.find({ _id: { $in: uniqueIds } }) : [];
  const bowler = bowlerStatsId ? await InningsBowlerModel.findById(bowlerStatsId) : null;

  ensureCurrentOver(innings);

  return {
    innings: {
      runs: innings.runs,
      wickets: innings.wickets,
      balls: innings.balls,
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
    batters: batters.map(snapshotBatter),
    bowler: bowler ? snapshotBowler(bowler) : null
  };
};

const restoreSnapshot = async (tenantId: string, innings: any, snapshot: Snapshot) => {
  innings.runs = snapshot.innings.runs;
  innings.wickets = snapshot.innings.wickets;
  innings.balls = snapshot.innings.balls;
  innings.status = snapshot.innings.status;
  innings.strikerId = snapshot.innings.strikerId;
  innings.nonStrikerId = snapshot.innings.nonStrikerId;
  innings.currentBowlerId = snapshot.innings.currentBowlerId;
  innings.currentOver = {
    overNumber: snapshot.innings.currentOver.overNumber,
    legalBallsInOver: snapshot.innings.currentOver.legalBallsInOver,
    balls: snapshot.innings.currentOver.balls
  };

  await Promise.all(
    snapshot.batters.map((b) =>
      InningsBatterModel.updateOne(
        { _id: b.id, tenantId, inningsId: innings._id },
        {
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
            outKind: b.outKind
          }
        },
        { upsert: true }
      )
    )
  );

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

    return { isLegal: true, summaryDisplay: 'W' };
  }

  if (input.type === 'swap') {
    return { isLegal: false, summaryDisplay: 'Swap' };
  }

  if (input.type === 'retire') {
    return { isLegal: false, summaryDisplay: 'Retire' };
  }

  return { isLegal: false, summaryDisplay: 'Undo' };
};

const calculateExtrasBreakdown = async (tenantId: string, matchId: string, inningsId: string) => {
  const scoredEvents = await ScoreEventModel.find({
    tenantId,
    matchId,
    inningsId,
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

  scoredEvents.forEach((event: { payload?: { extraType?: string; additionalRuns?: unknown; runsWithWicket?: unknown }; type?: string }) => {
    const payload = event.payload as
      | { extraType?: string; additionalRuns?: unknown; runsWithWicket?: unknown }
      | undefined;
    const eventType = event.type;

    if (eventType === 'extra') {
      const additionalRunsRaw = payload?.additionalRuns;
      const additionalRuns = typeof additionalRunsRaw === 'number' ? additionalRunsRaw : 0;

      if (payload?.extraType === 'wide') {
        wides += 1 + additionalRuns;
      } else if (payload?.extraType === 'noBall') {
        noBalls += 1;
      } else if (payload?.extraType === 'byes') {
        byes += additionalRuns;
      } else if (payload?.extraType === 'legByes') {
        legByes += additionalRuns;
      }
      return;
    }

    if (eventType === 'wicket') {
      const runsWithWicketRaw = payload?.runsWithWicket;
      const runsWithWicket = typeof runsWithWicketRaw === 'number' ? runsWithWicketRaw : 0;

      if (payload?.extraType === 'wide') {
        wides += 1 + runsWithWicket;
      } else if (payload?.extraType === 'noBall') {
        noBalls += 1 + runsWithWicket;
      }
    }
  });

  return {
    extras: wides + noBalls + byes + legByes,
    wides,
    noBalls,
    byes,
    legByes
  };
};

const getScoreboard = async (context: any) => {
  const inningsId = context.innings._id.toString();
  const tenantId = context.innings.tenantId.toString();
  const matchId = context.match._id.toString();

  const [batters, bowlers, extrasBreakdown] = await Promise.all([
    scopedFind(InningsBatterModel, tenantId, { inningsId }).sort({ createdAt: 1 }),
    scopedFind(InningsBowlerModel, tenantId, { inningsId }).sort({ createdAt: 1 }),
    calculateExtrasBreakdown(tenantId, matchId, inningsId)
  ]);

  ensureCurrentOver(context.innings);

  const asBatterId = (rawOnFieldId: string) => {
    const direct = batters.find((entry) => entry._id.toString() === rawOnFieldId);
    if (direct) {
      return direct._id.toString();
    }

    const byPlayer = batters.find(
      (entry) =>
        entry.playerRef?.playerId?.toString() === rawOnFieldId ||
        entry.batterKey?.playerId?.toString() === rawOnFieldId
    );

    return byPlayer?._id.toString() ?? rawOnFieldId;
  };

  return {
    matchId,
    inningsId,
    score: {
      runs: context.innings.runs,
      wickets: context.innings.wickets,
      balls: context.innings.balls,
      overs: formatOvers(context.innings.balls, context.ballsPerOver),
      extras: extrasBreakdown.extras,
      wides: extrasBreakdown.wides,
      noBalls: extrasBreakdown.noBalls,
      byes: extrasBreakdown.byes,
      legByes: extrasBreakdown.legByes
    },
    inningsCompleted: context.innings.status === 'COMPLETED',
    current: {
      strikerId: asBatterId(context.innings.strikerId.toString()),
      nonStrikerId: asBatterId(context.innings.nonStrikerId.toString()),
      bowlerId: context.innings.currentBowlerId.toString()
    },
    batters: batters.map((entry) => ({
      batterId: entry._id.toString(),
      name: entry.playerRef?.name ?? 'Unknown',
      runs: entry.runs,
      balls: entry.balls,
      fours: entry.fours,
      sixes: entry.sixes,
      isOut: entry.isOut
    })),
    bowlers: bowlers.map((entry) => {
      const overs = entry.balls / context.ballsPerOver;
      const economy = overs > 0 ? Number((entry.runsConceded / overs).toFixed(2)) : 0;

      return {
        bowlerId: entry.playerId.toString(),
        runsConceded: entry.runsConceded,
        balls: entry.balls,
        wickets: entry.wickets,
        foursConceded: entry.foursConceded,
        sixesConceded: entry.sixesConceded,
        wides: entry.wides,
        noBalls: entry.noBalls,
        economy
      };
    }),
    currentOver: {
      overNumber: context.innings.currentOver.overNumber,
      balls: context.innings.currentOver.balls.map((ball: any) => ({
        seq: typeof ball.seq === 'number' ? ball.seq : undefined,
        display: ball.display,
        isLegal: ball.isLegal
      }))
    }
  };
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
  const context = await ensureLiveContext(input.tenantId, input.matchId, true);

  const target = await ScoreEventModel.findOne({
    tenantId: input.tenantId,
    matchId: input.matchId,
    inningsId: context.innings._id,
    type: { $ne: 'undo' },
    isUndone: false
  }).sort({ seq: -1 });

  if (!target) {
    throw new AppError('No event available to undo.', 409, 'score.undo_empty');
  }

  const before = target.beforeSnapshot as Snapshot;
  const after = target.afterSnapshot as Snapshot;

  const undoBefore = await captureSnapshot(
    context.innings,
    after.batters.map((b) => b.id),
    after.bowler?.id
  );

  await restoreSnapshot(input.tenantId, context.innings, before);

  const createdBatterStatId = (target.payload as { createdBatterStatId?: string })?.createdBatterStatId;
  if (createdBatterStatId && !before.batters.some((b) => b.id === createdBatterStatId)) {
    const created = await InningsBatterModel.findOne({ _id: createdBatterStatId, tenantId: input.tenantId });

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

  target.isUndone = true;
  target.undoneAt = new Date();
  target.undoneByUserId = input.createdByUserId;
  await target.save();

  context.innings.eventSeq += 1;
  context.innings.lastSeq = context.innings.eventSeq;
  await context.innings.save();

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
    beforeSnapshot: undoBefore,
    afterSnapshot: before,
    createdByUserId: input.createdByUserId
  });

  const score = await getScoreboard(context);

  return {
    ...score,
    event: {
      id: undoEvent._id.toString(),
      type: undoEvent.type,
      seq: undoEvent.seq
    }
  };
};

const shouldCreditBowlerWicket = (wicketType: string) =>
  !['runOutStriker', 'runOutNonStriker', 'stumping', 'hitWicket', 'obstructingField'].includes(
    wicketType
  );

const validateWicketExtraCombination = (wicketType: string, extraType: string) => {
  if (extraType === 'none') {
    return;
  }

  const wideAllowed = new Set([
    'runOutStriker',
    'runOutNonStriker',
    'stumping',
    'hitWicket',
    'obstructingField'
  ]);

  const noBallAllowed = new Set(['runOutStriker', 'runOutNonStriker', 'obstructingField']);

  if (extraType === 'wide' && !wideAllowed.has(wicketType)) {
    throw new AppError('Invalid wicket type for wide delivery.', 400, 'score.wicket_extra_invalid');
  }

  if (extraType === 'noBall' && !noBallAllowed.has(wicketType)) {
    throw new AppError('Invalid wicket type for no-ball delivery.', 400, 'score.wicket_extra_invalid');
  }
};

const applyEvent = async (input: ScoreEventInput) => {
  const context = await ensureLiveContext(input.tenantId, input.matchId);

  const innings = context.innings;
  const striker = await resolveBatter(input.tenantId, innings._id.toString(), innings.strikerId.toString());
  const nonStriker = await resolveBatter(
    input.tenantId,
    innings._id.toString(),
    innings.nonStrikerId.toString()
  );
  const bowler = await resolveBowler(
    input.tenantId,
    innings._id.toString(),
    innings.currentBowlerId.toString()
  );
  const nextSeq = innings.eventSeq + 1;
  const maxLegalBalls = getMaxLegalBalls(innings, context.ballsPerOver);

  if (maxLegalBalls > 0 && innings.balls >= maxLegalBalls) {
    innings.status = 'COMPLETED';
    await innings.save();
    throw new AppError('Configured overs are completed.', 409, 'match.overs_completed');
  }

  const involved = new Set([striker._id.toString(), nonStriker._id.toString()]);
  const beforeSnapshot = await captureSnapshot(innings, [...involved], bowler._id.toString());

  let createdBatterStatId: string | undefined;
  let matchCompletedNow = false;

  if (input.type === 'swap') {
    swapStrike(innings);
  }

  if (input.type === 'retire') {
    const newBatter = await createNextBatter(
      input.tenantId,
      innings._id.toString(),
      context.battingIds,
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

    createdBatterStatId = newBatter._id.toString();
    involved.add(createdBatterStatId);
  }

  if (input.type === 'run') {
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

    if (runs % 2 === 1) {
      swapStrike(innings);
    }

    const overEnded = pushBall(innings, nextSeq, String(runs), true, context.ballsPerOver);
    if (maxLegalBalls > 0 && innings.balls >= maxLegalBalls) {
      innings.status = 'COMPLETED';
    }

    if (overEnded && innings.status !== 'COMPLETED') {
      swapStrike(innings);
    }
  }

  if (input.type === 'extra') {
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

    if (totalRuns % 2 === 1) {
      swapStrike(innings);
    }

    const overEnded = pushBall(innings, nextSeq, display, isLegal, context.ballsPerOver);
    if (isLegal && maxLegalBalls > 0 && innings.balls >= maxLegalBalls) {
      innings.status = 'COMPLETED';
    }

    if (overEnded && innings.status !== 'COMPLETED') {
      swapStrike(innings);
    }
  }

  if (input.type === 'wicket') {
    const wicketType = input.wicketType as string;
    const wicketExtraType = input.extraType ?? 'none';
    const runs = input.runsWithWicket ?? 0;
    const nextWickets = innings.wickets + 1;
    const maxWickets = Math.max(0, context.battingIds.size - 1);
    const inningsEndsOnWicket = maxWickets > 0 && nextWickets >= maxWickets;
    const isIllegalWicketDelivery = wicketExtraType === 'wide' || wicketExtraType === 'noBall';
    const penaltyRuns = wicketExtraType === 'wide' || wicketExtraType === 'noBall' ? 1 : 0;
    const totalRuns = penaltyRuns + runs;
    const shouldRotateOnRuns = totalRuns % 2 === 1;

    validateWicketExtraCombination(wicketType, wicketExtraType);

    if (!inningsEndsOnWicket && !input.newBatterId && !input.newBatterName) {
      throw new AppError('New batter is required.', 400, 'score.new_batter_required');
    }

    innings.runs += totalRuns;
    innings.wickets = nextWickets;
    if (!isIllegalWicketDelivery) {
      innings.balls += 1;
    }

    let fallen = striker;
    let fallenSide: 'striker' | 'nonStriker' = 'striker';

    if (wicketType === 'runOutStriker' || wicketType === 'runOutNonStriker') {
      fallenSide = input.runOutBatsman as 'striker' | 'nonStriker';
      fallen = fallenSide === 'striker' ? striker : nonStriker;
    }

    if (!isIllegalWicketDelivery) {
      fallen.runs += runs;
      fallen.balls += 1;
      if (runs === 4) fallen.fours += 1;
      if (runs === 6) fallen.sixes += 1;
    }
    fallen.isOut = true;
    fallen.outKind = wicketType;

    bowler.runsConceded += totalRuns;
    if (!isIllegalWicketDelivery) {
      bowler.balls += 1;
      if (runs === 4) bowler.foursConceded += 1;
      if (runs === 6) bowler.sixesConceded += 1;
    }
    if (wicketExtraType === 'wide') {
      bowler.wides += 1;
    }
    if (wicketExtraType === 'noBall') {
      bowler.noBalls += 1;
    }
    if (shouldCreditBowlerWicket(wicketType)) {
      bowler.wickets += 1;
    }

    if (!inningsEndsOnWicket) {
      const newBatter = await createNextBatter(
        input.tenantId,
        innings._id.toString(),
        context.battingIds,
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

      createdBatterStatId = newBatter._id.toString();
      involved.add(createdBatterStatId);
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

  const currentStriker = await resolveBatter(
    input.tenantId,
    innings._id.toString(),
    innings.strikerId.toString()
  );
  const currentNonStriker = await resolveBatter(
    input.tenantId,
    innings._id.toString(),
    innings.nonStrikerId.toString()
  );

  involved.add(currentStriker._id.toString());
  involved.add(currentNonStriker._id.toString());

  if (innings.inningsNumber === 2) {
    const innings1 = await scopedFindOne(InningsModel, input.tenantId, {
      matchId: input.matchId,
      inningsNumber: 1
    });

    if (!innings1) {
      throw new AppError('First innings not found.', 404, 'innings.not_found');
    }

    const maxLegalBalls = (innings.oversPerInnings ?? context.tournament.oversPerInnings) * context.ballsPerOver;
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
      matchCompletedNow = true;
    }
  }

  innings.eventSeq += 1;
  innings.lastSeq = innings.eventSeq;
  const saves: Array<Promise<unknown>> = [
    innings.save(),
    striker.save(),
    nonStriker.save(),
    bowler.save()
  ];
  if (typeof (context.match as { isModified?: () => boolean }).isModified === 'function' && context.match.isModified()) {
    saves.push(context.match.save());
  }

  await Promise.all(saves);

  if (matchCompletedNow) {
    await Promise.all([
      syncLeagueCompletionStatus(input.tenantId, context.match.tournamentId.toString()),
      syncKnockoutProgression(
        input.tenantId,
        context.match.tournamentId.toString(),
        context.match._id.toString()
      )
    ]);
  }

  const afterSnapshot = await captureSnapshot(innings, [...involved], bowler._id.toString());

  const meta = buildEventMeta(input);

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

  const score = await getScoreboard(context);

  return {
    ...score,
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



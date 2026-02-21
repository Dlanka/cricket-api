import { isValidObjectId } from 'mongoose';
import { InningsBatterModel } from '../models/inningsBatter';
import { InningsBowlerModel } from '../models/inningsBowler';
import { InningsModel } from '../models/innings';
import { PlayerModel } from '../models/player';
import { ScoreEventModel } from '../models/scoreEvent';
import { AppError } from '../utils/appError';
import { scopedFind, scopedFindOne } from '../utils/scopedQuery';

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

const getInningsOrThrow = async (tenantId: string, inningsId: string) => {
  ensureObjectId(tenantId, 'Invalid tenant id.');
  ensureObjectId(inningsId, 'Invalid innings id.');

  const innings = await scopedFindOne(InningsModel, tenantId, { _id: inningsId });

  if (!innings) {
    throw new AppError('Innings not found.', 404, 'innings.not_found');
  }

  return innings;
};

const activeEventFilter = (tenantId: string, inningsId: string) => ({
  tenantId,
  inningsId,
  $and: [
    { $or: [{ isUndone: false }, { isUndone: { $exists: false } }] },
    { $or: [{ undoneAt: null }, { undoneAt: { $exists: false } }] }
  ]
});

const deriveSummary = (event: {
  type: string;
  summaryDisplay?: string;
  payload?: Record<string, unknown>;
}) => {
  if (event.summaryDisplay) {
    return event.summaryDisplay;
  }

  const payload = event.payload ?? {};

  if (event.type === 'run') {
    return String(payload.runs ?? 0);
  }

  if (event.type === 'extra') {
    const extraType = payload.extraType as string | undefined;
    const additionalRuns = Number(payload.additionalRuns ?? 0);

    if (extraType === 'wide') {
      return additionalRuns > 0 ? `Wd+${additionalRuns}` : 'Wd';
    }

    if (extraType === 'noBall') {
      return additionalRuns > 0 ? `Nb+${additionalRuns}` : 'Nb';
    }

    if (extraType === 'byes') {
      return `B${additionalRuns}`;
    }

    return `Lb${additionalRuns}`;
  }

  if (event.type === 'wicket') {
    return 'W';
  }

  if (event.type === 'swap') {
    return 'Swap';
  }

  if (event.type === 'retire') {
    return 'Retire';
  }

  return 'Undo';
};

const deriveIsLegal = (event: { isLegal?: boolean; type: string; payload?: Record<string, unknown> }) => {
  if (typeof event.isLegal === 'boolean') {
    return event.isLegal;
  }

  if (event.type === 'run' || event.type === 'wicket') {
    return true;
  }

  if (event.type === 'extra') {
    const extraType = event.payload?.extraType as string | undefined;
    return extraType === 'byes' || extraType === 'legByes';
  }

  return false;
};

const deriveRuns = (event: { type: string; payload?: Record<string, unknown> }) => {
  const payload = event.payload ?? {};

  if (event.type === 'run') {
    return Number(payload.runs ?? 0);
  }

  if (event.type === 'extra') {
    const extraType = payload.extraType as string | undefined;
    const additionalRuns = Number(payload.additionalRuns ?? 0);

    if (extraType === 'wide' || extraType === 'noBall') {
      return 1 + additionalRuns;
    }

    return additionalRuns;
  }

  if (event.type === 'wicket') {
    return Number(payload.runsWithWicket ?? 0);
  }

  return 0;
};

const getSnapshotBowlerId = (event: { afterSnapshot?: unknown }) => {
  const snapshot = event.afterSnapshot;
  if (typeof snapshot !== 'object' || snapshot === null) {
    return null;
  }

  const innings = (snapshot as { innings?: unknown }).innings;
  if (typeof innings !== 'object' || innings === null) {
    return null;
  }

  const bowlerId = (innings as { currentBowlerId?: unknown }).currentBowlerId;
  return typeof bowlerId === 'string' ? bowlerId : null;
};

export const getBattersForInnings = async (tenantId: string, inningsId: string) => {
  await getInningsOrThrow(tenantId, inningsId);

  const items = await scopedFind(InningsBatterModel, tenantId, { inningsId }).sort({ position: 1, createdAt: 1 });

  return {
    items: items.map((entry) => ({
      batterId: entry._id.toString(),
      name: entry.playerRef?.name ?? entry.batterKey?.name ?? 'Unknown',
      runs: entry.runs,
      balls: entry.balls,
      fours: entry.fours,
      sixes: entry.sixes,
      isOut: entry.isOut,
      outKind: entry.outKind ?? null,
      sr: entry.balls > 0 ? Number(((entry.runs / entry.balls) * 100).toFixed(2)) : 0
    }))
  };
};

export const getBowlersForInnings = async (tenantId: string, inningsId: string) => {
  const innings = await getInningsOrThrow(tenantId, inningsId);
  const ballsPerOver = innings.ballsPerOver ?? 6;

  const bowlers = await scopedFind(InningsBowlerModel, tenantId, { inningsId }).sort({ balls: -1, createdAt: 1 });

  const missingNameIds = bowlers
    .filter((entry) => !entry.name)
    .map((entry) => entry.playerId.toString());

  const nameMap = new Map<string, string>();

  if (missingNameIds.length > 0) {
    const players = await PlayerModel.find({ _id: { $in: missingNameIds } }).select({ fullName: 1 });
    players.forEach((player) => {
      nameMap.set(player._id.toString(), player.fullName);
    });
  }

  return {
    items: bowlers.map((entry) => {
      const oversNumber = entry.balls / ballsPerOver;

      return {
        bowlerId: entry.playerId.toString(),
        name: entry.name || nameMap.get(entry.playerId.toString()) || 'Unknown',
        balls: entry.balls,
        overs: formatOvers(entry.balls, ballsPerOver),
        runsConceded: entry.runsConceded,
        wickets: entry.wickets,
        maidens: entry.maidens ?? 0,
        wides: entry.wides,
        noBalls: entry.noBalls,
        er: oversNumber > 0 ? Number((entry.runsConceded / oversNumber).toFixed(2)) : 0
      };
    })
  };
};

export const getOversForInnings = async (tenantId: string, inningsId: string, limit: number) => {
  const innings = await getInningsOrThrow(tenantId, inningsId);
  const ballsPerOver = innings.ballsPerOver ?? 6;

  const fetchLimit = Math.min(limit, 50) * ballsPerOver * 4;
  const events = await ScoreEventModel.find(activeEventFilter(tenantId, inningsId))
    .sort({ seq: -1 })
    .limit(fetchLimit);

  let legalRemaining = innings.balls;
  const overMap = new Map<
    number,
    { overNumber: number; bowlerId: string | null; balls: Array<{ seq: number; display: string; isLegal: boolean }>; runsThisOver: number }
  >();

  for (const event of events) {
    const summary = deriveSummary(event);
    const isLegal = deriveIsLegal(event);
    const runs = deriveRuns(event);
    const overNumber = legalRemaining > 0 ? Math.floor((legalRemaining - 1) / ballsPerOver) : 0;

    if (!overMap.has(overNumber)) {
      overMap.set(overNumber, {
        overNumber,
        bowlerId: getSnapshotBowlerId(event),
        balls: [],
        runsThisOver: 0
      });
    }

    const entry = overMap.get(overNumber)!;
    entry.balls.unshift({ seq: event.seq, display: summary, isLegal });
    entry.runsThisOver += runs;

    if (isLegal && legalRemaining > 0) {
      legalRemaining -= 1;
    }
  }

  const items = [...overMap.values()].sort((a, b) => b.overNumber - a.overNumber).slice(0, limit);

  return {
    items,
    nextCursor: null
  };
};

export const getEventsForInnings = async (
  tenantId: string,
  inningsId: string,
  cursor: number | null,
  limit: number
) => {
  await getInningsOrThrow(tenantId, inningsId);

  const query: Record<string, unknown> = activeEventFilter(tenantId, inningsId);

  if (cursor !== null) {
    query.seq = { $lt: cursor };
  }

  const events = await ScoreEventModel.find(query)
    .sort({ seq: -1 })
    .limit(limit);

  return {
    items: events.map((event) => ({
      id: event._id.toString(),
      seq: event.seq,
      type: event.type,
      summary: deriveSummary(event),
      isLegal: deriveIsLegal(event),
      createdAt: event.createdAt
    })),
    nextCursor: events.length === limit ? events[events.length - 1].seq : null
  };
};

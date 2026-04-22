import type { Server as HttpServer } from 'http';
import { isValidObjectId } from 'mongoose';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

type SocketAuth = {
  userId: string;
  tenantId: string;
  role: string;
};

type ScoreUpdatePayload = {
  matchId: string;
  score: unknown;
  ts: number;
};

type ScoreRefreshPayload = {
  matchId: string;
  ts: number;
};

let io: Server | null = null;

const parseCookieHeader = (cookieHeader: string | undefined) => {
  if (!cookieHeader) return new Map<string, string>();
  const pairs = cookieHeader.split(';');
  const map = new Map<string, string>();
  pairs.forEach((pair) => {
    const [rawKey, ...rest] = pair.trim().split('=');
    if (!rawKey) return;
    map.set(rawKey, decodeURIComponent(rest.join('=')));
  });
  return map;
};

const getTokenFromHandshake = (auth: {
  cookieHeader?: string;
  authorization?: string;
  authToken?: unknown;
}) => {
  const fromAuthToken = typeof auth.authToken === 'string' ? auth.authToken : null;
  if (fromAuthToken && fromAuthToken.length > 0) {
    return fromAuthToken;
  }

  const header = auth.authorization;
  if (typeof header === 'string') {
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) {
      return token;
    }
  }

  const cookies = parseCookieHeader(auth.cookieHeader);
  return cookies.get(env.AUTH_COOKIE_NAME) ?? null;
};

const roomKey = (tenantId: string, matchId: string) => `tenant:${tenantId}:match:${matchId}`;

const toSocketAuth = (payload: JwtPayload): SocketAuth | null => {
  if (payload.scope !== 'app') {
    return null;
  }

  const userId = (payload.sub as string | undefined) ?? (payload.userId as string | undefined);
  const tenantId = payload.tenantId as string | undefined;
  const role = payload.role as string | undefined;

  if (!userId || !tenantId || !role) {
    return null;
  }

  return { userId, tenantId, role };
};

export const initMatchScoreRealtime = (httpServer: HttpServer) => {
  if (io) {
    return io;
  }

  const allowedOrigins = env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const corsOrigin = allowedOrigins.includes('*') ? true : allowedOrigins;

  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true
    }
  });

  io.use((socket, next) => {
    try {
      const token = getTokenFromHandshake({
        cookieHeader: socket.handshake.headers.cookie,
        authorization:
          typeof socket.handshake.headers.authorization === 'string'
            ? socket.handshake.headers.authorization
            : undefined,
        authToken: socket.handshake.auth?.token
      });
      if (!token) {
        return next(new Error('auth.missing_token'));
      }

      const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      const parsed = toSocketAuth(payload);
      if (!parsed) {
        return next(new Error('auth.invalid_token'));
      }

      socket.data.auth = parsed;
      return next();
    } catch (error) {
      return next(new Error('auth.invalid_token'));
    }
  });

  io.on('connection', (socket) => {
    socket.on(
      'match:subscribe',
      (payload: { matchId?: string }, ack?: (response: { ok: boolean; code?: string }) => void) => {
        const matchId = payload?.matchId;
        const tenantId = (socket.data.auth as SocketAuth | undefined)?.tenantId;
        if (!tenantId || !matchId || !isValidObjectId(matchId)) {
          ack?.({ ok: false, code: 'validation.invalid_match_id' });
          return;
        }

        socket.join(roomKey(tenantId, matchId));
        ack?.({ ok: true });
      }
    );

    socket.on('match:unsubscribe', (payload: { matchId?: string }) => {
      const matchId = payload?.matchId;
      const tenantId = (socket.data.auth as SocketAuth | undefined)?.tenantId;
      if (!tenantId || !matchId || !isValidObjectId(matchId)) {
        return;
      }
      socket.leave(roomKey(tenantId, matchId));
    });
  });

  logger.info('Match score realtime socket initialized');
  return io;
};

export const emitMatchScoreUpdate = (tenantId: string, matchId: string, score: unknown) => {
  if (!io) return;
  const payload: ScoreUpdatePayload = {
    matchId,
    score,
    ts: Date.now()
  };
  io.to(roomKey(tenantId, matchId)).emit('score:update', payload);
};

export const emitMatchScoreRefresh = (tenantId: string, matchId: string) => {
  if (!io) return;
  const payload: ScoreRefreshPayload = {
    matchId,
    ts: Date.now()
  };
  io.to(roomKey(tenantId, matchId)).emit('score:refresh', payload);
};


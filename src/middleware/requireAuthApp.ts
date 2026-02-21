import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/appError';

const getToken = (req: Request): string | null => {
  const cookieToken = req.cookies?.[env.AUTH_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
};

export const requireAuthApp = (req: Request, _res: Response, next: NextFunction) => {
  const token = getToken(req);
  if (!token) {
    return next(new AppError('Authentication token missing.', 401, 'auth.missing_token'));
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

    if (payload.scope !== 'app') {
      return next(new AppError('Invalid token scope.', 403, 'auth.invalid_scope'));
    }

    const userId = (payload.sub as string | undefined) ?? (payload.userId as string | undefined);
    const tenantId = payload.tenantId as string | undefined;
    const role = payload.role as string | undefined;

    if (!userId || !tenantId || !role) {
      return next(new AppError('Invalid token payload.', 401, 'auth.invalid_token'));
    }

    req.auth = { userId, tenantId, role };
    req.tokenPayload = payload;

    return next();
  } catch (error) {
    return next(new AppError('Invalid or expired token.', 401, 'auth.invalid_token'));
  }
};

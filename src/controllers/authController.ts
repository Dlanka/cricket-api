import { z } from 'zod';
import type { Request, Response, NextFunction, CookieOptions } from 'express';
import { ok } from '../utils/apiResponse';
import { env } from '../config/env';
import {
  loginWithPassword,
  selectTenantSession,
  getMeFromToken,
  signupWithPassword
} from '../services/authService';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().trim().min(1),
  tenantName: z.string().trim().min(1)
});

const selectTenantSchema = z.object({
  loginSessionToken: z.string().min(1),
  tenantId: z.string().min(1)
});

const accessCookieMaxAgeMs = 12 * 60 * 60 * 1000;

const setAuthCookie = (res: Response, token: string) => {
  const options: CookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
    maxAge: accessCookieMaxAgeMs
  };

  if (env.COOKIE_DOMAIN) {
    options.domain = env.COOKIE_DOMAIN;
  }

  res.cookie(env.AUTH_COOKIE_NAME, token, options);
};

const clearAuthCookie = (res: Response) => {
  const options: CookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/'
  };

  if (env.COOKIE_DOMAIN) {
    options.domain = env.COOKIE_DOMAIN;
  }

  res.clearCookie(env.AUTH_COOKIE_NAME, options);
};

export const signup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = signupSchema.parse(req.body);
    const result = await signupWithPassword(input);
    setAuthCookie(res, result.accessToken);
    return res.status(201).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await loginWithPassword(input.email, input.password);
    if (result.mode === 'LOGGED_IN') {
      setAuthCookie(res, result.accessToken);
    }
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const selectTenant = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = selectTenantSchema.parse(req.body);
    const result = await selectTenantSession(input.loginSessionToken, input.tenantId);
    if (result.mode === 'LOGGED_IN') {
      setAuthCookie(res, result.accessToken);
    }
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getMeFromToken(req);
    return res.status(200).json(ok(result));
  } catch (error) {
    return next(error);
  }
};

export const logout = (_req: Request, res: Response, next: NextFunction) => {
  try {
    clearAuthCookie(res);
    return res.status(200).json(ok({ loggedOut: true }));
  } catch (error) {
    return next(error);
  }
};

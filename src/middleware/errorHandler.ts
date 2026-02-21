import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/appError';
import { fail } from '../utils/apiResponse';
import { logger } from '../config/logger';

export const errorHandler = (
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json(
      fail({
        code: error.code,
        message: error.message,
        details: error.details
      })
    );
  }

  if (error instanceof ZodError) {
    return res.status(400).json(
      fail({
        code: 'validation.failed',
        message: 'Request validation failed.',
        details: {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        }
      })
    );
  }

  logger.error({ err: error }, 'Unhandled error');

  return res.status(500).json(
    fail({
      code: 'server.error',
      message: 'Unexpected error occurred.'
    })
  );
};

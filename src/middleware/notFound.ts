import type { Request, Response } from 'express';
import { fail } from '../utils/apiResponse';

export const notFound = (req: Request, res: Response) => {
  res.status(404).json(
    fail({
      code: 'route.not_found',
      message: `Route ${req.method} ${req.path} not found.`
    })
  );
};

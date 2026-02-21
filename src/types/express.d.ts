import type { JwtPayload } from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      userId?: string;
      role?: string;
      auth?: {
        userId: string;
        tenantId: string;
        role: string;
      };
      tokenPayload?: JwtPayload | string;
    }
  }
}

export {};

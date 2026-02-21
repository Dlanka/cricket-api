import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(1),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MONGODB_URI: z.string().min(1),
  AUTH_COOKIE_NAME: z.string().default('cricket_access'),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment configuration: ${issues.join(', ')}`);
}

export const env = parsed.data;

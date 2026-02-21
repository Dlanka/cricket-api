import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { logger } from './config/logger';
import { routes } from './routes';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';

export const app = express();

const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
const corsOrigin = allowedOrigins.includes('*') ? true : allowedOrigins;

app.use(pinoHttp({ logger }));
app.use(helmet());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use(routes);
app.use(notFound);
app.use(errorHandler);

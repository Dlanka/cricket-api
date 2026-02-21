import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../config/logger';

export const connectToDatabase = async () => {
  try {
    await mongoose.connect(env.MONGODB_URI);
    logger.info('MongoDB connected');
  } catch (error) {
    logger.error({ err: error }, 'MongoDB connection failed');
    throw error;
  }
};

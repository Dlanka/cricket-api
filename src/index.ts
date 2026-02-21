import { app } from './app';
import { connectToDatabase } from './db/mongo';
import { env } from './config/env';
import { logger } from './config/logger';

const startServer = async () => {
  try {
    await connectToDatabase();

    app.listen(env.PORT, () => {
      logger.info({ port: env.PORT }, 'API server listening');
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
};

startServer();

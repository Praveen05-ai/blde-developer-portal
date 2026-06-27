import app from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { db } from './db/connection.js';
import { runPreflightChecks } from './services/preflightStartup.js';
import { startHealthMonitoring } from './services/serviceHealth.js';

const startServer = async () => {
  try {
    // 1. Run ordered GxP preflight validation gates before boot
    await runPreflightChecks();

    // 2. Start Service Health telemetry heartbeats
    startHealthMonitoring();

    // 3. Start background sync polling worker for standalone/university client installations (Step 13)
    if (env.deploymentMode === 'standalone' || env.deploymentMode === 'university') {
      const { pullSurveyResponsesFromCentral } = await import('./services/syncManager.js');
      // Poll Render cloud buffer every 30 seconds
      const syncInterval = setInterval(async () => {
        try {
          await pullSurveyResponsesFromCentral();
        } catch (err) {
          logger.error(`❌ [BACKGROUND SYNC] Error polling survey responses: ${err.message}`);
        }
      }, 30000);
      syncInterval.unref(); // Allow the process to exit cleanly
      logger.info('🔄 [BACKGROUND SYNC] Started survey response polling worker (30s interval)');
    }

    // 4. Start Express listener safely bound to localhost default
    const server = app.listen(env.port, env.host, () => {
      logger.info(`🚀 BLDE EDC API Server running in [${env.nodeEnv}] mode`);
      logger.info(`   Local Address: http://${env.host}:${env.port}`);
    });

    server.on('error', (err) => {
      logger.error('❌ CRITICAL startup socket error:', err.message);
      process.exit(1);
    });

    // 4. Graceful Shutdown Handler
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      
      server.close(async () => {
        logger.info('HTTP server closed.');
        try {
          // Close Knex database connections pool cleanly
          await db.destroy();
          logger.info('Database connection pool closed successfully.');
          
          // Flush Winston logger streams cleanly before exit
          logger.on('finish', () => {
            process.exit(0);
          });
          logger.end();
          
          process.exit(0);
        } catch (err) {
          logger.error('Error closing database pool:', err);
          process.exit(1);
        }
      });

      // Force shutdown after 5s
      setTimeout(() => {
        logger.error('Forced shutdown due to timeout');
        process.exit(1);
      }, 5000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('❌ CRITICAL BOOT FAILURE: Server startup aborted.', error.message);
    process.exit(1);
  }
};

startServer();

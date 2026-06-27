import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export const errorHandler = (err, req, res, _next) => {
  const status = err.status || 500;
  
  const response = {
    error: err.message || 'Internal Server Error',
  };

  // Stack trace is only exposed in local development environment
  if (env.nodeEnv === 'development') {
    response.stack = err.stack;
  }

  logger.error(`${req.method} ${req.originalUrl} - Error ${status}: ${err.message}`, {
    stack: err.stack,
    ip: req.ip,
  });

  res.status(status).json(response);
};

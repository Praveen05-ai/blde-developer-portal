import morgan from 'morgan';
import { morganStream } from '../config/logger.js';
import { env } from '../config/env.js';

// Use 'combined' format in production (standard apache layout), 'dev' in development
const format = env.nodeEnv === 'production' ? 'combined' : 'dev';

export const requestLogger = morgan(format, { stream: morganStream });
export default requestLogger;

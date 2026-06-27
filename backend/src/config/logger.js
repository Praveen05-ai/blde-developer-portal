import winston from 'winston';
import { env } from './env.js';
import path from 'path';
import fs from 'fs';

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  env.nodeEnv === 'development'
    ? winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.printf(
          (info) => `[${info.timestamp}] [${info.level}]: ${info.message}` + (info.stack ? `\n${info.stack}` : '')
        )
      )
    : winston.format.json()
);

const transports = [
  new winston.transports.Console(),
  new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: winston.format.json()
  }),
  new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    format: winston.format.json()
  }),
];

export const logger = winston.createLogger({
  level: env.nodeEnv === 'development' ? 'debug' : 'info',
  levels,
  format,
  transports,
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'exceptions.log') }),
    new winston.transports.Console()
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'rejections.log') }),
    new winston.transports.Console()
  ],
  exitOnError: false,
});

// Create a stream object for Morgan
export const morganStream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

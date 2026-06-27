import rateLimit from 'express-rate-limit';

const getEnvLimit = (envVar, defaultValue) => {
  const val = process.env[envVar];
  if (val) {
    const num = parseInt(val, 10);
    if (!isNaN(num)) return num;
  }
  return defaultValue;
};

export const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: (req) => getEnvLimit('RATE_LIMIT_LOGIN', 5),
  message: { error: 'Too many login attempts, please try again after a minute' },
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: (req) => getEnvLimit('RATE_LIMIT_REGISTER', 3),
  message: { error: 'Too many registration attempts, please try again after a minute' },
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429
});

export const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: (req) => getEnvLimit('RATE_LIMIT_UPLOAD', 10),
  message: { error: 'Too many file uploads, please try again after 5 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429
});

export const downloadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: (req) => getEnvLimit('RATE_LIMIT_DOWNLOAD', 20),
  message: { error: 'Too many file downloads, please try again after 5 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429
});

export const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: (req) => getEnvLimit('RATE_LIMIT_FEEDBACK', 5),
  message: { error: 'Too many feedback submissions, please try again after a minute' },
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429
});

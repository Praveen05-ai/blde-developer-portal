import express from 'express';
import { getSurveyDetails, submitSurveyResponse, uploadSurveyAttachment } from '../controllers/surveyController.js';
import multer from 'multer';
import path from 'path';
import { env } from '../config/env.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, env.uploads.dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: env.uploads.maxSizeBytes }
});

// Memory-based IP rate-limiter for public survey submissions (Step 13)
const ipLimits = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 5; // max 5 submissions per minute per IP

const surveyRateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  
  if (!ipLimits.has(ip)) {
    ipLimits.set(ip, []);
  }
  
  const timestamps = ipLimits.get(ip).filter(t => now - t < RATE_LIMIT_WINDOW);
  
  if (timestamps.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many survey submissions. Please try again in a minute.' });
  }
  
  timestamps.push(now);
  ipLimits.set(ip, timestamps);
  next();
};

router.get('/:token', getSurveyDetails);
router.post('/:token', surveyRateLimiter, submitSurveyResponse);
router.post('/:token/attachments', upload.single('file'), uploadSurveyAttachment);

export default router;

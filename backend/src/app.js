import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import apiRouter from './routes/index.js';

import { maintenanceMiddleware } from './updater/maintenanceMode.js';

const app = express();

// Create uploads directory if not exists
if (!fs.existsSync(env.uploads.dir)) {
  fs.mkdirSync(env.uploads.dir, { recursive: true });
}

// Maintenance Mode Interceptor
app.use(maintenanceMiddleware);

// 1. GLOBAL MIDDLEWARES
app.use(cors({
  origin: '*', // Customize this for specific origins in production
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);

// Global Cache-Busting Headers Middleware
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

// Static uploads serving
app.use('/uploads', express.static(env.uploads.dir));

// 2. API MOUNTING
app.use('/api', apiRouter);

// Serve Static Frontend files if folder is present (supporting local dev and docker containers)
const frontendDirLocal = path.resolve(process.cwd(), '../frontend');
const frontendDirDocker = path.resolve(process.cwd(), './frontend');
const frontendDir = fs.existsSync(frontendDirDocker) ? frontendDirDocker : frontendDirLocal;
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
}

// 3. UNIFIED ERROR HANDLER
app.use(errorHandler);

export default app;

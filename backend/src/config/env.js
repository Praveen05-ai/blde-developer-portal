// Disable SSL certificate verification to bypass university network firewall and SSL-inspection proxy blocks
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { runtime } from './runtimeConfig.js';

// Load .env file from root of backend if present (as manual developer overrides)
const backendDir = path.resolve(process.cwd());
const envPath = path.join(backendDir, '.env');
let parsedEnv = {};
if (fs.existsSync(envPath)) {
  const result = dotenv.config({ path: envPath });
  parsedEnv = result.parsed || {};
} else {
  const result = dotenv.config();
  parsedEnv = result.parsed || {};
}

// 1. Unified Configuration Mappings Driven by runtimeConfig
const databaseMode = 'pg';

const requiredEnv = ['JWT_SECRET', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

const missingEnv = [];
for (const envVar of requiredEnv) {
  if (!process.env[envVar] && !runtime[envVar.toLowerCase()]) {
    missingEnv.push(envVar);
  }
}

if (missingEnv.length > 0) {
  console.error(`\x1b[31m❌ CRITICAL SYSTEM ERROR: Missing required environment variables:\x1b[0m`);
  missingEnv.forEach(v => console.error(`   - ${v}`));
  console.error(`\x1b[33mPlease verify that JWT_SECRET is populated in ".env" or "/config/runtime.json"\x1b[0m\n`);
  process.exit(1);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'production',
  port: parseInt(process.env.PORT || String(runtime.port), 10),
  host: parsedEnv.HOST || process.env.HOST || (process.env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1'), // Bind to 0.0.0.0 on Render, localhost on laptop
  databaseMode,
  deploymentMode: process.env.DEPLOYMENT_MODE || (runtime.deployment_profile === 'single_user_laptop' ? 'standalone' : (runtime.deployment_profile === 'university' ? 'university' : 'saas')),
  db: {
    client: 'pg',
    host: process.env.DB_HOST || runtime.db_host || 'localhost',
    port: parseInt(process.env.DB_PORT || runtime.db_port || '5432', 10),
    user: process.env.DB_USER || runtime.db_user,
    password: process.env.DB_PASSWORD || runtime.db_password,
    name: process.env.DB_NAME || runtime.db_name,
    ssl: process.env.DB_SSL === 'true'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'blde_du_edc_production_grade_secret_key_2026_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  },
  centralSupportUrl: process.env.CENTRAL_SUPPORT_URL || 'https://blde-edc-platform.onrender.com',
  licenseKey: process.env.LICENSE_KEY || 'BLDE-SAAS-0001',
  uploads: {
    dir: runtime.storagePaths.uploads,
    maxSizeBytes: parseInt(process.env.MAX_FILE_SIZE_MB || '20', 10) * 1024 * 1024
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'noreply@blde.ac.in'
  },
  features: {
    enableAI: runtime.features.enable_ai,
    enableOrthanc: runtime.features.enable_orthanc,
    storageProvider: process.env.STORAGE_PROVIDER || 'local'
  }
};

export default env;

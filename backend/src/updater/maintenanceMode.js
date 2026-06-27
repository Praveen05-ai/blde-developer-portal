import fs from 'fs';
import path from 'path';
import { runtime } from '../config/runtimeConfig.js';

const maintenanceFilePath = path.join(runtime.storagePaths.temp, '.maintenance');

/**
 * Checks if maintenance mode is globally locked.
 */
export const isMaintenanceActive = () => {
  return fs.existsSync(maintenanceFilePath);
};

/**
 * Locks the application into secure maintenance mode.
 */
export const enableMaintenance = () => {
  try {
    fs.writeFileSync(maintenanceFilePath, 'MAINTENANCE_LOCK_ACTIVE', 'utf8');
    console.log('🔒 [MAINTENANCE MODE] Active maintenance lock engaged.');
  } catch (err) {
    console.error(`⚠️  Failed to lock maintenance mode: ${err.message}`);
  }
};

/**
 * Releases the application from maintenance mode.
 */
export const disableMaintenance = () => {
  try {
    if (fs.existsSync(maintenanceFilePath)) {
      fs.unlinkSync(maintenanceFilePath);
      console.log('🔓 [MAINTENANCE MODE] Maintenance lock released. Normal operations resumed.');
    }
  } catch (err) {
    console.error(`⚠️  Failed to unlock maintenance mode: ${err.message}`);
  }
};

/**
 * GxP-Compliant Maintenance Mode middleware.
 * Blocks all mutating operations during system upgrades.
 * Permits only safe authentication, diagnostics, and status tracking routes.
 */
export const maintenanceMiddleware = (req, res, next) => {
  if (isMaintenanceActive()) {
    res.set('X-BLDE-MAINTENANCE', 'true');

    const allowedUrls = [
      '/api/auth/login',
      '/api/auth/logout',
      '/api/diagnostics',
      '/api/updater/status',
      '/api/updater/rollback-status'
    ];

    const isAllowedUrl = allowedUrls.some(url => req.originalUrl.startsWith(url));
    const isMutatingMethod = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);

    if (isMutatingMethod && !isAllowedUrl) {
      return res.status(503).json({
        status: 'maintenance',
        message: 'System update currently in progress.'
      });
    }
  }
  next();
};

export default {
  isMaintenanceActive,
  enableMaintenance,
  disableMaintenance,
  maintenanceMiddleware
};

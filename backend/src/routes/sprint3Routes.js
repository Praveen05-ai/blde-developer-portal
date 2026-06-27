import express from 'express';
import multer from 'multer';
import path from 'path';
import { env } from '../config/env.js';
import { auth } from '../middleware/auth.js';
import {
  getNotifications,
  readNotification,
  createInternalNote,
  getInternalNotes,
  uploadDeliverable,
  getDeliverables,
  getAllDeliverables,
  downloadDeliverable,
  getActivityLogs,
  getAssignmentHistory,
  triggerBackupEndpoint,
  triggerRestoreEndpoint,
  getBackupsEndpoint,
  getRollbackStatusEndpoint,
  clearRollbackFaultEndpoint,
  getFounderMetricsEndpoint,
  getSyncConnectionStatus,
  toggleSyncConnection,
  triggerSyncReconcile,
  triggerLicenseCheckIn,
  submitFeedback,
  getFeedbackList,
  getDashboardMetrics,
  getMyFeedbackList,
  updateFeedbackStatus
} from '../controllers/sprint3Controller.js';
import { requireRole } from '../middleware/auth.js';

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

import { uploadLimiter, downloadLimiter, feedbackLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// 1. Notifications
router.get('/notifications', auth, getNotifications);
router.put('/notifications/:id/read', auth, readNotification);

// 2. Internal Notes
router.post('/internal-notes', auth, createInternalNote);
router.get('/internal-notes/:type/:id', auth, getInternalNotes);

// 3. Deliverables
router.get('/deliverables', auth, getAllDeliverables);
router.post('/deliverables/upload', auth, uploadLimiter, upload.single('file'), uploadDeliverable);
router.get('/deliverables/download/:id', auth, downloadLimiter, downloadDeliverable);
router.get('/deliverables/:type/:id', auth, getDeliverables);

// 4. Feeds and Audit Queues
router.get('/activity-logs', auth, getActivityLogs);
router.get('/assignment-history/:type/:id', auth, getAssignmentHistory);

// 5. Maintenance & GxP Backup
router.get('/maintenance/founder-metrics', auth, requireRole(['super_admin', 'ops', 'operations_manager']), getFounderMetricsEndpoint);
router.post('/maintenance/backup', auth, requireRole(['super_admin', 'admin', 'ops', 'operations_manager']), triggerBackupEndpoint);
router.post('/maintenance/restore', auth, requireRole(['super_admin']), triggerRestoreEndpoint);
router.get('/maintenance/backups', auth, requireRole(['super_admin', 'admin', 'ops', 'operations_manager']), getBackupsEndpoint);
router.get('/maintenance/rollback-status', auth, requireRole(['super_admin', 'admin', 'ops', 'operations_manager']), getRollbackStatusEndpoint);
router.post('/maintenance/clear-fault', auth, requireRole(['super_admin', 'admin']), clearRollbackFaultEndpoint);

// 6. Central Support Sync & License check-in
router.get('/sync/connection-status', auth, requireRole(['super_admin', 'admin', 'ops', 'operations_manager']), getSyncConnectionStatus);
router.post('/sync/toggle-connection', auth, requireRole(['super_admin', 'admin']), toggleSyncConnection);
router.post('/sync/reconcile', auth, requireRole(['super_admin', 'admin']), triggerSyncReconcile);
router.post('/sync/license-checkin', auth, requireRole(['super_admin', 'admin']), triggerLicenseCheckIn);

// 7. Pilot Feedback Module
router.post('/feedback', auth, feedbackLimiter, upload.single('screenshot'), submitFeedback);
router.get('/feedback', auth, getFeedbackList);
router.get('/feedback/my', auth, getMyFeedbackList);
router.put('/feedback/:id', auth, requireRole(['super_admin', 'admin', 'ops', 'operations_manager']), updateFeedbackStatus);

// 8. Founder Acceptance Metrics Dashboard
router.get('/metrics/dashboard', auth, requireRole(['super_admin', 'ops', 'operations_manager']), getDashboardMetrics);

// 9. E2E Dynamic Mode Switcher (Dev only)
router.post('/maintenance/toggle-deployment-mode', (req, res) => {
  const { mode } = req.body;
  if (!['standalone', 'university', 'saas'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  env.deploymentMode = mode;
  res.json({ success: true, currentMode: env.deploymentMode });
});

export default router;


import express from 'express';
import authRoutes from './authRoutes.js';
import projectRoutes from './projectRoutes.js';
import recordRoutes from './recordRoutes.js';
import exportRoutes from './exportRoutes.js';
import surveyRoutes from './surveyRoutes.js';
import syncRoutes from './syncRoutes.js';
import orgRoutes from './orgRoutes.js';
import sprint2Routes from './sprint2Routes.js';
import sprint3Routes from './sprint3Routes.js';
import licenseActivationRoutes from './licenseActivationRoutes.js';

// Developer-specific imports
import licenseRoutes from './licenseRoutes.js';
import subscriptionRoutes from './subscriptionRoutes.js';
import invoiceRoutes from './invoiceRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import billingReportsRoutes from './billingReportsRoutes.js';
import { handleHeartbeat, handleCommandAcknowledgement } from '../controllers/licenseHeartbeatController.js';

import { getStats, getGlobalAuditLog, createAuditLog } from '../controllers/projectController.js';
import { auth } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { verifyLicenseMiddleware } from '../middleware/licenseVerifier.js';

const router = express.Router();

import db from '../db/connection.js';
router.get('/debug-licenses', async (req, res) => {
  try {
    const affected = await db('licenses').whereIn('id', [2, 3]).update({
      machine_binding_status: 'unbound',
      machine_hash: null
    });
    const deletedTicketsCount = await db('consultation_tickets').del();
    const list = await db('licenses').select('id', 'license_id_str', 'status', 'remote_status', 'machine_id', 'machine_hash', 'machine_binding_status', 'signature');
    res.json({ affected, list, deletedTicketsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mount global license verification middleware
router.use(verifyLicenseMiddleware);

// Developer heartbeat endpoints
router.post('/license-heartbeat', handleHeartbeat);
router.post('/license-heartbeat/acknowledge', handleCommandAcknowledgement);

// Mount modular sub-routers
router.use('/auth', authRoutes);
router.use('/organizations', orgRoutes);
router.use('/projects', recordRoutes);
router.use('/projects', projectRoutes);
router.use('/records', recordRoutes);
router.use('/exports', exportRoutes);
router.use('/survey', surveyRoutes);
router.use('/', syncRoutes);
router.use('/', sprint2Routes);
router.use('/', sprint3Routes);
router.use('/license-activation', licenseActivationRoutes);

// Mount developer routers
router.use('/license-mgmt', licenseRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/billing-reports', billingReportsRoutes);

router.get('/stats', auth, getStats);
router.get('/audit', auth, getGlobalAuditLog);
router.post('/audit', auth, createAuditLog);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    deploymentMode: env.deploymentMode
  });
});



export default router;

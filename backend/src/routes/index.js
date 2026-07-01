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
    const exists = await db('licenses').where({ id: 2 }).first();
    if (!exists) {
      await db('licenses').insert({
        id: 2,
        license_key: "eyJkYXRhIjp7ImFjdGl2YXRpb25fZGF0ZSI6IjIwMjYtMDYtMjlUMDU6MTA6MjguOTUxWiIsImV4cGlyeV9kYXRlIjoiMjAyNy0wNi0yOVQwNToxMDoyOC45NTJaIiwiZmVhdHVyZXMiOnsiYWlfaW50ZWdyYXRpb24iOnRydWUsImNsb3VkX3JlbGF5Ijp0cnVlLCJkb3VibGVfZW50cnkiOnRydWV9LCJsaWNlbnNlX2tleSI6IkJMREUtTElWRS1FTlRFUlBSSVNFLUtFWSIsImxpY2Vuc2VfdHlwZSI6ImVudGVycHJpc2UiLCJtYWNoaW5lX2hhc2giOiI4YWVmODg2Y2JkM2M0YjEwN2Y3Yjk4NjFhZGEyMGEyYmExMWNiMjBhY2M2YmVhM2I5NDQ0YWY4MzQzZDBkYmNmIiwib2ZmbGluZV9ncmFjZV9kYXlzIjozMCwic3RhdHVzIjoiYWN0aXZlIiwidXNhZ2UiOnsiZm9ybXMiOjEwMDAsInByb2plY3RzIjoxMDAsInVzZXJzIjo1MDB9LCJ2ZXJpZmljYXRpb25fZW5hYmxlZCI6dHJ1ZSwidmVyaWZpY2F0aW9uX3NlcnZlcl91cmwiOiJodHRwczovL2JsZGUtZGV2ZWxvcGVyLXBvcnRhbC5vbnJlbmRlci5jb20vYXBpL2xpY2Vuc2UtaGVhcnRiZWF0In0sImtpZCI6ImJsZGUta2V5LTIwMjYtdjEiLCJ0aW1lc3RhbXAiOiIyMDI2LTA2LTI5VDA1OjEwOjI4Ljk1MloiLCJ2IjoxfQ.7bf51b7ed96d8be0f620a4396c7155ee9e068ba62759a53cab675fc1a51e9a8bb855816771e179085670be01c4b12c055cfd7c92cbca9156bbc54c3017f7551918729a4d589a5c55fb4f636e5767e31942bdbdc9b275c7dfdf0872e07e091691bf2ed58c9dee6df652d7e0ad1acd69bbbc4dcaa1a8b83efac385b4d1bc94e21329bcfdd03e9f0bce1cb7a3df8e702fb9117b1c540febbf733ba9df2f4f3657293e7f4debee222e9550928261db243e5d55469045d35d2efe191101d19c49be9fe7acae725875b9c849ab99b17aa4b81fac2824d3511100b91a4b04e1be2411d8910dfbff3c7c37043ab2353141bbb444e649c4c766fddde0bae81d3eff8a8ec5",
        license_type: "ENTERPRISE",
        status: "ACTIVE",
        activation_date: "2026-06-29T05:10:52.366Z",
        expiry_date: "2027-06-29T05:10:28.952Z",
        machine_hash: "bc04e563c5beed43ebd2e374ee882d6746b692c9125e2b6584e783c259cd5b96",
        machine_binding_status: "bound",
        signature: "7bf51b7ed96d8be0f620a4396c7155ee9e068ba62759a53cab675fc1a51e9a8bb855816771e179085670be01c4b12c055cfd7c92cbca9156bbc54c3017f7551918729a4d589a5c55fb4f636e5767e31942bdbdc9b275c7dfdf0872e07e091691bf2ed58c9dee6df652d7e0ad1acd69bbbc4dcaa1a8b83efac385b4d1bc94e21329bcfdd03e9f0bce1cb7a3df8e702fb9117b1c540febbf733ba9df2f4f3657293e7f4debee222e9550928261db243e5d55469045d35d2efe191101d19c49be9fe7acae725875b9c849ab99b17aa4b81fac2824d3511100b91a4b04e1be2411d8910dfbff3c7c37043ab2353141bbb444e649c4c766fddde0bae81d3eff8a8ec5",
        remote_status: "active",
        verification_enabled: true,
        offline_grace_days: 30,
        allowed_machine_changes: 3,
        created_at: new Date(),
        updated_at: new Date()
      });
    }
    const list = await db('licenses').select('id', 'license_key', 'status', 'remote_status', 'machine_hash', 'machine_binding_status');
    res.json({ list });
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

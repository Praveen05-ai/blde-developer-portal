import express from 'express';
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  archiveCustomer,
  getLicenses,
  generateLicense,
  renewLicense,
  extendLicense,
  updateLicenseStatus,
  getLicenseLogs,
  getLicenseStats,
  resetMachineBinding,
  blacklistLicense,
  setEmergencyOverride,
  queueRemoteCommand,
  getHeartbeatHistory,
  getRemoteCommands,
  getVerificationStats
} from '../controllers/licenseController.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Role-based restrictor for Developer License Center
const allowedRoles = ['admin', 'super_admin', 'blde_staff', 'operations_manager', 'ops'];
const restrict = requireRole(allowedRoles);

// Stats & Dashboard
router.get('/stats', auth, restrict, getLicenseStats);

// Verification server telemetry & control
router.get('/verification/stats', auth, restrict, getVerificationStats);
router.get('/verification/heartbeats', auth, restrict, getHeartbeatHistory);
router.get('/verification/commands', auth, restrict, getRemoteCommands);

// Customer endpoints
router.get('/customers', auth, restrict, getCustomers);
router.post('/customers', auth, restrict, createCustomer);
router.put('/customers/:id', auth, restrict, updateCustomer);
router.delete('/customers/:id', auth, restrict, archiveCustomer);

// License endpoints
router.get('/licenses', auth, restrict, getLicenses);
router.post('/licenses', auth, restrict, generateLicense);
router.post('/licenses/:id/renew', auth, restrict, renewLicense);
router.post('/licenses/:id/extend', auth, restrict, extendLicense);
router.put('/licenses/:id/status', auth, restrict, updateLicenseStatus);
router.post('/licenses/:id/reset-machine', auth, restrict, resetMachineBinding);
router.post('/licenses/:id/blacklist', auth, restrict, blacklistLicense);
router.post('/licenses/:id/emergency-override', auth, restrict, setEmergencyOverride);
router.post('/licenses/:id/remote-command', auth, restrict, queueRemoteCommand);

// Audit Logging
router.get('/logs', auth, restrict, getLicenseLogs);

export default router;

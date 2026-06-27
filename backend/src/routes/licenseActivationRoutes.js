import express from 'express';
import {
  getActivationStatus,
  getActivationUsage,
  getActivationFeatures,
  getActivationHistory,
  activateLicense,
  triggerManualVerification
} from '../controllers/licenseActivationController.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = express.Router();
const allowedRoles = ['admin'];
const restrict = requireRole(allowedRoles);

// License Activation Endpoints
router.get('/status', auth, restrict, getActivationStatus);
router.get('/usage', auth, restrict, getActivationUsage);
router.get('/features', auth, restrict, getActivationFeatures);
router.get('/history', auth, restrict, getActivationHistory);
router.post('/activate', auth, restrict, activateLicense);
router.post('/verify-now', auth, restrict, triggerManualVerification);

export default router;

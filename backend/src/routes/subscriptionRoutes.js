import express from 'express';
import {
  getPlans,
  createPlan,
  updatePlan,
  archivePlan,
  getSubscriptions,
  createSubscription,
  renewSubscription,
  extendSubscription,
  cancelSubscription,
  getExpiringSubscriptions,
  getGraceModeCustomers
} from '../controllers/subscriptionController.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = express.Router();
const allowedRoles = ['admin', 'super_admin', 'blde_staff', 'ops', 'operations_manager'];
const restrict = requireRole(allowedRoles);

// Plan Routes
router.get('/plans', auth, restrict, getPlans);
router.post('/plans', auth, restrict, createPlan);
router.put('/plans/:id', auth, restrict, updatePlan);
router.delete('/plans/:id', auth, restrict, archivePlan);

// Subscription Lifecycle Routes
router.get('/', auth, restrict, getSubscriptions);
router.post('/', auth, restrict, createSubscription);
router.post('/:id/renew', auth, restrict, renewSubscription);
router.post('/:id/extend', auth, restrict, extendSubscription);
router.post('/:id/cancel', auth, restrict, cancelSubscription);

// Monitoring / Operational Routes
router.get('/expiring', auth, restrict, getExpiringSubscriptions);
router.get('/grace', auth, restrict, getGraceModeCustomers);

export default router;

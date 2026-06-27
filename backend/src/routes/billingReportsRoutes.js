import express from 'express';
import {
  getRevenueSummary,
  getPendingInvoices,
  getExpiredSubscriptions,
  getPaymentHistory,
  getBillingLogs
} from '../controllers/billingReportsController.js';
import { checkExpiringSubscriptions } from '../services/renewalService.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = express.Router();
const allowedRoles = ['admin', 'super_admin', 'blde_staff', 'ops', 'operations_manager'];
const restrict = requireRole(allowedRoles);

router.get('/revenue', auth, restrict, getRevenueSummary);
router.get('/pending', auth, restrict, getPendingInvoices);
router.get('/expired', auth, restrict, getExpiredSubscriptions);
router.get('/payments', auth, restrict, getPaymentHistory);
router.get('/logs', auth, restrict, getBillingLogs);

// GxP Audit Scheduler Manual Check API
router.post('/trigger-cron', auth, restrict, async (req, res) => {
  try {
    const logs = await checkExpiringSubscriptions();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

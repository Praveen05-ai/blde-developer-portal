import express from 'express';
import {
  getPayments,
  recordPayment,
  refundPayment
} from '../controllers/paymentController.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = express.Router();
const allowedRoles = ['admin', 'super_admin', 'blde_staff', 'ops', 'operations_manager'];
const restrict = requireRole(allowedRoles);

router.get('/', auth, restrict, getPayments);
router.post('/', auth, restrict, recordPayment);
router.post('/:id/refund', auth, restrict, refundPayment);

export default router;

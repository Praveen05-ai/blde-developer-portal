import express from 'express';
import {
  getInvoices,
  generateInvoice,
  downloadInvoice,
  cancelInvoice
} from '../controllers/invoiceController.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = express.Router();
const allowedRoles = ['admin', 'super_admin', 'blde_staff', 'ops', 'operations_manager'];
const restrict = requireRole(allowedRoles);

router.get('/', auth, restrict, getInvoices);
router.post('/', auth, restrict, generateInvoice);
router.get('/:id/download', auth, restrict, downloadInvoice);
router.post('/:id/cancel', auth, restrict, cancelInvoice);

export default router;

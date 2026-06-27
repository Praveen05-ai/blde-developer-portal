import express from 'express';
import {
  getOrganizations,
  createOrganization,
  getOrganizationById,
  updateOrganization,
  deleteOrganization,
} from '../controllers/orgController.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Public list for user registration dropdown
router.get('/public', getOrganizations);

// Organization management requires admin privilege (role check)
router.get('/', auth, getOrganizations);
router.post('/', auth, requireRole(['admin']), createOrganization);
router.get('/:id', auth, getOrganizationById);
router.put('/:id', auth, requireRole(['admin']), updateOrganization);
router.delete('/:id', auth, requireRole(['admin']), deleteOrganization);

export default router;

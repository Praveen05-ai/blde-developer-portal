import express from 'express';
import {
  getRecords,
  enrollSubject,
  saveClinicalData,
  lockRecord,
  deleteRecord,
  getNextRecordId,
} from '../controllers/recordController.js';
import { auth } from '../middleware/auth.js';
import { validateClinicalData } from '../middleware/validator.js';
import { checkRecordLimit } from '../middleware/licenseVerifier.js';

const router = express.Router();

// protect records routes with auth
router.get('/:pid/records', auth, getRecords);
router.get('/:pid/next-record-id', auth, getNextRecordId);
router.post('/:pid/records', auth, checkRecordLimit, enrollSubject);
router.put('/:pid/records/:id', auth, validateClinicalData, saveClinicalData);
router.post('/:pid/records/:id/lock', auth, lockRecord);
router.delete('/:pid/records/:id', auth, deleteRecord);

export default router;

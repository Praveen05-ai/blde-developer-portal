import express from 'express';
import {
  exportCSV,
  exportRScript,
  exportPythonScript,
  exportZip,
} from '../controllers/exportController.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// protect analytical export downloads with authentication
router.get('/:pid/csv', auth, exportCSV);
router.get('/:pid/r', auth, exportRScript);
router.get('/:pid/python', auth, exportPythonScript);
router.get('/:pid/zip', auth, exportZip);

export default router;

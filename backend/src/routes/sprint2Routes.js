import express from 'express';
import multer from 'multer';
import path from 'path';
import { env } from '../config/env.js';
import { auth } from '../middleware/auth.js';
import {
  createBlueprintRequest,
  getBlueprintRequests,
  getBlueprintRequestById,
  updateBlueprintRequest,
  markBlueprintReceived,
  createPackageRequest,
  getPackageRequests,
  getPackageRequestById,
  updatePackageRequest,
  markPackageReceived,
  createSupportTicket,
  getSupportTickets,
  getSupportTicketById,
  updateSupportTicket,
  createCommunication,
  getCommunications,
  uploadCommunicationAttachment
} from '../controllers/sprint2Controller.js';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, env.uploads.dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: env.uploads.maxSizeBytes }
});

const router = express.Router();

// 1. Blueprint Requests
router.post('/blueprints', auth, createBlueprintRequest);
router.get('/blueprints', auth, getBlueprintRequests);
router.get('/blueprints/:id', auth, getBlueprintRequestById);
router.put('/blueprints/:id', auth, updateBlueprintRequest);
router.post('/blueprints/:id/receive', auth, markBlueprintReceived);

// 2. Package Requests
router.post('/packages', auth, createPackageRequest);
router.get('/packages', auth, getPackageRequests);
router.get('/packages/:id', auth, getPackageRequestById);
router.put('/packages/:id', auth, updatePackageRequest);
router.post('/packages/:id/receive', auth, markPackageReceived);

// 3. Support Tickets
router.post('/tickets', auth, createSupportTicket);
router.get('/tickets', auth, getSupportTickets);
router.get('/tickets/:id', auth, getSupportTicketById);
router.put('/tickets/:id', auth, updateSupportTicket);

// 4. Communications
router.post('/communications', auth, createCommunication);
router.get('/communications/:type/:id', auth, getCommunications);
router.post('/communications/upload', auth, upload.single('file'), uploadCommunicationAttachment);

export default router;

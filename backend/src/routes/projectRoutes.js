import express from 'express';
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  createSite,
  getSites,
  assignUser,
  getProjectPermissions,
  revokeProjectPermission,
  getInstruments,
  createInstrument,
  updateInstrument,
  publishInstrument,
  getEvents,
  createEvent,
  deleteEvent,
  getPatientSchedule,
  schedulePatientEvent,
  runReport,
  deleteProject,
  getRandSchemes,
  createRandScheme,
  toggleSeal,
  getRandStats,
  getRandAllocations,
  allocateParticipant,
  unblindParticipant,
  uploadAttachment,
  getDDEData,
  submitDDERecord,
  resolveDDEConflict,
  getAlertRules,
  createAlertRule,
  toggleAlertRule,
  deleteAlertRule,
  getAlertLog,
  testAlertRule,
  getSurveys,
  createSurvey,
  closeSurvey,
  syncSurveyEndpoint,
  getProjectAuditLog,
  getDQRules,
  createDQRule,
  deleteDQRule,
  runDQ,
  getQueries,
  createQuery,
  resolveQuery,
} from '../controllers/projectController.js';
import { exportProjectTemplate, importProjectTemplate, previewProjectTemplate } from '../controllers/portabilityController.js';
import { submitRequest, getRequests, getConsultants, assignTicket, uploadDeliverable, updateTicketStatus } from '../controllers/consultationController.js';
import multer from 'multer';
import path from 'path';
import { env } from '../config/env.js';

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
import { auth, requireRole } from '../middleware/auth.js';
import { checkProjectLimit, checkFormLimit, checkUploadLimits } from '../middleware/licenseVerifier.js';

const router = express.Router();

// Project list and creation
router.post('/', auth, requireRole(['admin', 'researcher']), checkProjectLimit, createProject);
router.get('/', auth, getProjects);
router.get('/:id', auth, getProjectById);
router.put('/:id', auth, requireRole(['admin', 'researcher']), updateProject);
router.delete('/:pid', auth, requireRole(['admin', 'researcher']), deleteProject);

// Site management (DAGs)
router.post('/:pid/sites', auth, requireRole(['admin', 'pi', 'project_incharge']), createSite);
router.get('/:pid/sites', auth, getSites);

// User assignment to projects and sites
router.post('/:pid/assign', auth, requireRole(['admin', 'pi', 'project_incharge']), assignUser);
router.get('/:pid/permissions', auth, getProjectPermissions);
router.post('/:pid/permissions', auth, requireRole(['admin', 'pi', 'project_incharge']), assignUser);
router.delete('/:pid/permissions/:uid', auth, requireRole(['admin', 'pi', 'project_incharge']), revokeProjectPermission);

// Instrument definitions
router.get('/:pid/instruments', auth, getInstruments);
router.post('/:pid/instruments', auth, requireRole(['admin', 'researcher', 'pi', 'project_incharge']), checkFormLimit, createInstrument);
router.put('/:pid/instruments/:id', auth, requireRole(['admin', 'researcher', 'pi', 'project_incharge']), updateInstrument);
router.post('/:pid/instruments/:id/publish', auth, requireRole(['admin', 'researcher', 'pi', 'project_incharge']), publishInstrument);

// Longitudinal Events & Scheduling
router.get('/:pid/events', auth, getEvents);
router.post('/:pid/events', auth, requireRole(['admin', 'researcher', 'pi']), createEvent);
router.delete('/:pid/events/:id', auth, requireRole(['admin', 'researcher', 'pi']), deleteEvent);
router.get('/:pid/schedule/:rid', auth, getPatientSchedule);
router.post('/:pid/schedule', auth, schedulePatientEvent);

// Randomisation management routes
router.get('/:pid/rand/schemes', auth, getRandSchemes);
router.post('/:pid/rand/schemes', auth, requireRole(['admin', 'researcher', 'pi']), createRandScheme);
router.post('/:pid/rand/schemes/:id/seal', auth, requireRole(['admin', 'researcher', 'pi']), toggleSeal);
router.get('/:pid/rand/stats', auth, getRandStats);
router.get('/:pid/rand/allocations', auth, getRandAllocations);
router.post('/:pid/rand/allocate', auth, allocateParticipant);
router.post('/:pid/rand/unblind/:id', auth, requireRole('admin'), unblindParticipant);

// Data Quality (DQ) routes
router.get('/:pid/dq/rules', auth, getDQRules);
router.post('/:pid/dq/rules', auth, requireRole(['admin', 'researcher', 'pi']), createDQRule);
router.delete('/:pid/dq/rules/:id', auth, requireRole(['admin', 'researcher', 'pi']), deleteDQRule);
router.get('/:pid/dq/run', auth, runDQ);

// Query workflow routes
router.get('/:pid/queries', auth, getQueries);
router.post('/:pid/queries', auth, createQuery);
router.put('/:pid/queries/:qid/resolve', auth, resolveQuery);

// Reports management
router.get('/:pid/reports', auth, (req, res) => res.json([]));
router.post('/:pid/reports', auth, (req, res) => res.json({ success: true }));
router.post('/:pid/reports/run', auth, runReport);

// Attachment uploads
router.post('/:pid/attachments', auth, upload.single('file'), checkUploadLimits, uploadAttachment);

// Double Data Entry (DDE) routes
router.get('/:pid/dde', auth, getDDEData);
router.post('/:pid/dde', auth, submitDDERecord);
router.post('/:pid/dde/:id/resolve', auth, resolveDDEConflict);

// Alerts routes
router.get('/:pid/alerts', auth, getAlertRules);
router.post('/:pid/alerts', auth, createAlertRule);
router.put('/:pid/alerts/:id', auth, toggleAlertRule);
router.delete('/:pid/alerts/:id', auth, deleteAlertRule);
router.get('/:pid/alert-log', auth, getAlertLog);
router.post('/:pid/alerts/:id/test', auth, testAlertRule);

// Public survey management routes
router.get('/:pid/surveys', auth, getSurveys);
router.post('/:pid/surveys', auth, requireRole(['admin', 'researcher']), createSurvey);
router.delete('/:pid/surveys/:id', auth, requireRole(['admin', 'researcher']), closeSurvey);
router.post('/:pid/surveys/:id/sync', auth, requireRole(['admin', 'researcher']), syncSurveyEndpoint);

// Project audit logs
router.get('/:pid/audit', auth, getProjectAuditLog);

// Project template export/import
router.get('/:pid/export', auth, requireRole(['admin', 'researcher']), exportProjectTemplate);
router.post('/import', auth, requireRole(['admin', 'researcher']), importProjectTemplate);
router.post('/import/preview', auth, requireRole(['admin', 'researcher']), previewProjectTemplate);

// Research Consultation & Ticketing
router.post('/consultation/requests', auth, submitRequest);
router.get('/consultation/requests', auth, getRequests);
router.get('/consultation/consultants', auth, getConsultants);
router.post('/consultation/requests/:id/assign', auth, requireRole('admin'), assignTicket);
router.post('/consultation/requests/:id/deliver', auth, requireRole(['admin', 'researcher']), uploadDeliverable);
router.post('/consultation/requests/:id/status', auth, updateTicketStatus);
router.post('/consultation/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ filename: req.file.filename });
});

export default router;

import db from '../db/connection.js';
import { logger } from '../config/logger.js';
import { logActivity, createNotification } from '../utils/activity.js';
import { env } from '../config/env.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createUpdateBackup } from '../updater/backupManager.js';
import { triggerRollback, clearRollbackFault, isRollbackFaultActive } from '../updater/rollbackManager.js';
import { runtime } from '../config/runtimeConfig.js';
import { setCentralConnectionState, getCentralConnectionState, processOfflineSyncQueue, performLicenseCheckIn, getLicenseStatus } from '../services/syncManager.js';
import { validateFileSignature } from '../utils/fileValidator.js';

// Central check for BLDE Central Support Admin
const isCentralAdmin = (user) => {
  const role = (user.role || '').toLowerCase();
  return (role === 'admin' || role === 'super_admin') && (user.organization_id === 1 || user.organization_id === null);
};

const isStaffUser = (user) => {
  const role = (user.role || '').toLowerCase();
  return ['admin', 'blde_staff', 'ops', 'operations_manager', 'super_admin'].includes(role);
};

// ==========================================
// 1. NOTIFICATIONS
// ==========================================

export const getNotifications = async (req, res, next) => {
  try {
    const notifications = await db('notifications')
      .where({ user_id: req.user.id })
      .orderBy('created_at', 'desc');
    res.json(notifications);
  } catch (error) {
    next(error);
  }
};

export const readNotification = async (req, res, next) => {
  const { id } = req.params;
  try {
    const affected = await db('notifications')
      .where({ id, user_id: req.user.id })
      .update({ read: true });
    
    if (!affected) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 2. INTERNAL NOTES (Staff only)
// ==========================================

export const createInternalNote = async (req, res, next) => {
  const { related_type, related_id, note } = req.body;

  if (!isStaffUser(req.user)) {
    return res.status(403).json({ error: 'Access denied. Staff only.' });
  }

  if (!related_type || !related_id || !note) {
    return res.status(400).json({ error: 'related_type, related_id, and note are required' });
  }

  const trx = await db.transaction();
  try {
    // Check target record and get organization_id
    let targetRecord;
    if (related_type === 'blueprint') {
      targetRecord = await trx('blueprint_requests').where({ id: related_id }).first();
    } else if (related_type === 'package') {
      targetRecord = await trx('package_requests').where({ id: related_id }).first();
    } else if (related_type === 'ticket') {
      targetRecord = await trx('support_tickets').where({ id: related_id }).first();
    }

    if (!targetRecord) {
      await trx.rollback();
      return res.status(404).json({ error: `Related ${related_type} request not found` });
    }

    const [inserted] = await trx('internal_notes')
      .insert({
        organization_id: targetRecord.organization_id,
        related_type,
        related_id,
        staff_id: req.user.id,
        note,
        created_at: new Date()
      })
      .returning('*');

    await logActivity(trx, {
      organizationId: targetRecord.organization_id,
      userId: req.user.id,
      entityType: related_type,
      entityId: related_id,
      action: 'note_add',
      metadata: { snippet: note.slice(0, 50) }
    });

    await trx.commit();
    res.status(201).json(inserted);
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const getInternalNotes = async (req, res, next) => {
  const { type, id } = req.params;

  if (!isStaffUser(req.user)) {
    return res.status(403).json({ error: 'Access denied. Staff only.' });
  }

  try {
    const notes = await db('internal_notes as n')
      .leftJoin('users as u', 'n.staff_id', 'u.id')
      .select('n.*', 'u.name as staff_name', 'u.email as staff_email')
      .where({ 'n.related_type': type, 'n.related_id': id })
      .orderBy('n.created_at', 'desc');

    res.json(notes);
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 3. DELIVERABLES MODULE (Upload/Download/History)
// ==========================================

export const uploadDeliverable = async (req, res, next) => {
  const { related_type, related_id, delivery_notes, category } = req.body;
  const file = req.file;

  if (!isStaffUser(req.user)) {
    return res.status(403).json({ error: 'Access denied. Staff only.' });
  }

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!related_type || !related_id) {
    return res.status(400).json({ error: 'related_type and related_id are required' });
  }

  const validCategories = [
    'Project Blueprint',
    'Dataset Template',
    'Data Collection Format',
    'Annotation Protocol',
    'Model Development Package',
    'Source Code',
    'Deployment Package',
    'Documentation',
    'Publication Support',
    'Regulatory Documents',
    'Custom'
  ];

  if (!category || !validCategories.includes(category)) {
    return res.status(400).json({ error: `Invalid or missing category. Must be one of: ${validCategories.join(', ')}` });
  }

  const trx = await db.transaction();
  try {
    // 1. Get Target Request Details and verify existence
    let targetRecord;
    let title = '';
    let investigatorId = null;

    if (related_type === 'blueprint') {
      targetRecord = await trx('blueprint_requests').where({ id: related_id }).first();
      if (targetRecord) {
        title = targetRecord.title;
        investigatorId = targetRecord.submitted_by;
      }
    } else if (related_type === 'package') {
      targetRecord = await trx('package_requests').where({ id: related_id }).first();
      if (targetRecord) {
        title = `Package Request for Project: ${targetRecord.project_id}`;
        investigatorId = targetRecord.requested_by;
      }
    } else {
      // Allow report, dataset, source_code, publication, certificate, custom
      // If linked to blueprint_requests, fetch it
      targetRecord = await trx('blueprint_requests').where({ id: related_id }).first();
      if (targetRecord) {
        title = `${related_type.toUpperCase()} upload for ${targetRecord.title}`;
        investigatorId = targetRecord.submitted_by;
      } else {
        // Fallback checks on package requests
        targetRecord = await trx('package_requests').where({ id: related_id }).first();
        if (targetRecord) {
          title = `${related_type.toUpperCase()} upload for Package request #${targetRecord.id}`;
          investigatorId = targetRecord.requested_by;
        }
      }
    }

    if (!targetRecord) {
      await trx.rollback();
      return res.status(404).json({ error: `Related ${related_type} request not found` });
    }

    // 2. Compute SHA-256 Checksum and check binary signatures (Sprint 4A component 2)
    const fileBuffer = fs.readFileSync(file.path);
    const { valid, mime } = validateFileSignature(fileBuffer, file.originalname);
    if (!valid) {
      fs.unlinkSync(file.path); // Delete invalid uploaded file from disk immediately
      await trx.rollback();
      return res.status(400).json({ error: 'File verification failed. Binary signature does not match file extension.' });
    }
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 3. Versioning Strategy: check if duplicate name exists for this request
    const existing = await trx('deliverables')
      .where({ related_type, related_id, name: file.originalname })
      .orderBy('version', 'desc')
      .first();
    const version = existing ? existing.version + 1 : 1;

    // 4. Create Deliverable Record
    const [deliverable] = await trx('deliverables')
      .insert({
        organization_id: targetRecord.organization_id,
        related_type,
        related_id,
        uploaded_by: req.user.id,
        name: file.originalname,
        file_path: `/uploads/${file.filename}`,
        file_size: file.size,
        checksum,
        version,
        delivery_notes: delivery_notes || null,
        category,
        mime_type: mime,
        created_at: new Date()
      })
      .returning('*');

    // 5. Update Status of Blueprint/Package request automatically to 'ready_for_delivery'
    const statusField = 'ready_for_delivery';
    if (related_type === 'blueprint') {
      await trx('blueprint_requests').where({ id: related_id }).update({ status: statusField, updated_at: new Date() });
    } else if (related_type === 'package') {
      await trx('package_requests').where({ id: related_id }).update({ status: statusField, updated_at: new Date() });
    }

    // 6. Log activity and notifications
    await logActivity(trx, {
      organizationId: targetRecord.organization_id,
      userId: req.user.id,
      entityType: 'deliverable',
      entityId: deliverable.id,
      action: 'upload',
      metadata: { name: file.originalname, version, size: file.size, related_type }
    });

    if (investigatorId) {
      await createNotification(trx, {
        userId: investigatorId,
        title: 'New Deliverable Uploaded',
        message: `A new version (v${version}) of deliverable "${file.originalname}" has been uploaded for your request. Checksum: ${checksum.slice(0, 10)}...`,
        relatedType: related_type,
        relatedId: related_id
      });
    }

    await trx.commit();
    res.status(201).json(deliverable);
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const getDeliverables = async (req, res, next) => {
  const { type, id } = req.params;
  try {
    let queryBuilder = db('deliverables as d')
      .leftJoin('users as u', 'd.uploaded_by', 'u.id')
      .select('d.*', 'u.name as uploader_name')
      .where({ 'd.related_type': type, 'd.related_id': id });

    // Isolation: Only central support admin and staff can see all. Tenant users see only their own org.
    if (!isStaffUser(req.user) && !isCentralAdmin(req.user)) {
      queryBuilder = queryBuilder.where('d.organization_id', req.user.organization_id);
    }

    const list = await queryBuilder.orderBy('d.version', 'desc').orderBy('d.created_at', 'desc');
    res.json(list);
  } catch (error) {
    next(error);
  }
};

export const downloadDeliverable = async (req, res, next) => {
  const { id } = req.params;
  try {
    const deliverable = await db('deliverables').where({ id }).first();
    if (!deliverable) {
      return res.status(404).json({ error: 'Deliverable file not found' });
    }

    // Secure Isolation check
    if (!isStaffUser(req.user) && !isCentralAdmin(req.user) && deliverable.organization_id !== req.user.organization_id) {
      return res.status(403).json({ error: 'Access denied to this deliverable' });
    }

    // Resolve absolute path to file
    const rootPath = path.resolve(env.uploads.dir);
    // If path starts with /uploads/ remove prefix
    const cleanFilename = deliverable.file_path.replace(/^\/uploads\//, '');
    const absoluteFilePath = path.join(rootPath, cleanFilename);

    if (!fs.existsSync(absoluteFilePath)) {
      return res.status(404).json({ error: 'Physical deliverable file not found on disk' });
    }

    const trx = await db.transaction();
    try {
      // 1. Insert into deliverable_downloads
      await trx('deliverable_downloads').insert({
        deliverable_id: deliverable.id,
        user_id: req.user.id,
        organization_id: req.user.organization_id || 1,
        ip_address: req.ip,
        downloaded_at: new Date()
      });

      // 2. Log download activity
      await logActivity(trx, {
        organizationId: deliverable.organization_id,
        userId: req.user.id,
        entityType: 'deliverable',
        entityId: deliverable.id,
        action: 'download',
        metadata: { name: deliverable.name, version: deliverable.version, ip: req.ip }
      });

      await trx.commit();
    } catch (err) {
      await trx.rollback();
      logger.error(`Error tracking download for deliverable ${id}: ${err.message}`);
    }

    res.download(absoluteFilePath, deliverable.name);
  } catch (error) {
    next(error);
  }
};

export const getAllDeliverables = async (req, res, next) => {
  try {
    let queryBuilder = db('deliverables as d')
      .leftJoin('users as u', 'd.uploaded_by', 'u.id')
      .select('d.*', 'u.name as uploader_name');

    if (!isStaffUser(req.user) && !isCentralAdmin(req.user)) {
      queryBuilder = queryBuilder.where('d.organization_id', req.user.organization_id);
    }

    const list = await queryBuilder.orderBy('d.created_at', 'desc');
    res.json(list);
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 4. AUDIT & FEED DATA
// ==========================================

export const getActivityLogs = async (req, res, next) => {
  if (!isStaffUser(req.user)) {
    return res.status(403).json({ error: 'Access denied. Staff only.' });
  }

  try {
    const logs = await db('activity_logs as al')
      .leftJoin('users as u', 'al.user_id', 'u.id')
      .leftJoin('organizations as o', 'al.organization_id', 'o.id')
      .select('al.*', 'u.name as user_name', 'u.email as user_email', 'o.name as org_name')
      .orderBy('al.created_at', 'desc')
      .limit(100);

    res.json(logs);
  } catch (error) {
    next(error);
  }
};

export const getAssignmentHistory = async (req, res, next) => {
  const { type, id } = req.params;
  try {
    const list = await db('assignment_history as ah')
      .leftJoin('users as u1', 'ah.assigned_by', 'u1.id')
      .leftJoin('users as u2', 'ah.assigned_to', 'u2.id')
      .select('ah.*', 'u1.name as assigner_name', 'u2.name as assignee_name')
      .where({ 'ah.request_type': type, 'ah.request_id': id })
      .orderBy('ah.created_at', 'desc');

    res.json(list);
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 5. MAINTENANCE & BACKUP
// ==========================================

export const triggerBackupEndpoint = async (req, res, next) => {
  try {
    const backupPath = await createUpdateBackup();
    res.json({ success: true, backupPath });
  } catch (error) {
    next(error);
  }
};

export const triggerRestoreEndpoint = async (req, res, next) => {
  const { backupPath } = req.body;
  if (!backupPath) {
    return res.status(400).json({ error: 'backupPath is required' });
  }
  try {
    const success = await triggerRollback(backupPath);
    res.json({ success, message: 'System rollback completed successfully. Server restarting.' });
    // Process exit to trigger restart
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  } catch (error) {
    next(error);
  }
};

export const getBackupsEndpoint = async (req, res, next) => {
  try {
    const backupsDir = runtime.storagePaths.backups;
    if (!fs.existsSync(backupsDir)) {
      return res.json([]);
    }
    const folders = fs.readdirSync(backupsDir);
    const results = [];
    for (const folder of folders) {
      const folderPath = path.join(backupsDir, folder);
      if (fs.statSync(folderPath).isDirectory()) {
        const manifestPath = path.join(folderPath, 'backup_manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            results.push({
              name: folder,
              path: folderPath,
              ...manifest
            });
          } catch (e) {
            results.push({
              name: folder,
              path: folderPath,
              error: 'Invalid manifest'
            });
          }
        }
      }
    }
    // Sort by name descending
    results.sort((a, b) => b.name.localeCompare(a.name));
    res.json(results);
  } catch (error) {
    next(error);
  }
};

export const getRollbackStatusEndpoint = async (req, res, next) => {
  try {
    const faultActive = isRollbackFaultActive();
    let reason = null;
    if (faultActive) {
      const faultLockPath = path.join(runtime.storagePaths.temp, '.rollback_fault');
      if (fs.existsSync(faultLockPath)) {
        try {
          const faultInfo = JSON.parse(fs.readFileSync(faultLockPath, 'utf8'));
          reason = faultInfo.reason;
        } catch (_) {}
      }
    }
    res.json({ faultActive, reason });
  } catch (error) {
    next(error);
  }
};

export const clearRollbackFaultEndpoint = async (req, res, next) => {
  try {
    clearRollbackFault();
    res.json({ success: true, message: 'Rollback fault lock successfully cleared.' });
  } catch (error) {
    next(error);
  }
};

export const getFounderMetricsEndpoint = async (req, res, next) => {
  try {
    const totalProjectsObj = await db('projects').count('id as count').first();
    const totalBlueprintRequestsObj = await db('blueprint_requests').count('id as count').first();
    const totalPackageRequestsObj = await db('package_requests').count('id as count').first();
    const totalDeliverablesObj = await db('deliverables').count('id as count').first();
    const totalDownloadsObj = await db('deliverable_downloads').count('id as count').first();
    const openTicketsObj = await db('support_tickets').whereNot({ status: 'closed' }).count('id as count').first();
    const closedTicketsObj = await db('support_tickets').where({ status: 'closed' }).count('id as count').first();

    res.json({
      totalProjects: totalProjectsObj?.count || 0,
      totalBlueprintRequests: totalBlueprintRequestsObj?.count || 0,
      totalPackageRequests: totalPackageRequestsObj?.count || 0,
      totalDeliverables: totalDeliverablesObj?.count || 0,
      totalDownloads: totalDownloadsObj?.count || 0,
      openTickets: openTicketsObj?.count || 0,
      closedTickets: closedTicketsObj?.count || 0
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 6. CENTRAL SYNC & LICENSING
// ==========================================

export const getSyncConnectionStatus = async (req, res, next) => {
  try {
    const isConnected = getCentralConnectionState();
    const licenseStatus = getLicenseStatus();
    res.json({
      connected: isConnected,
      license: licenseStatus
    });
  } catch (error) {
    next(error);
  }
};

export const toggleSyncConnection = async (req, res, next) => {
  const { connected } = req.body;
  try {
    const state = setCentralConnectionState(connected);
    res.json({ success: true, connected: state });
  } catch (error) {
    next(error);
  }
};

export const triggerSyncReconcile = async (req, res, next) => {
  try {
    const result = await processOfflineSyncQueue();
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const triggerLicenseCheckIn = async (req, res, next) => {
  const { licenseId } = req.body;
  try {
    const status = await performLicenseCheckIn(licenseId);
    res.json(status);
  } catch (error) {
    next(error);
  }
};

export const submitFeedback = async (req, res, next) => {
  const { category, severity, workflow_stage, description } = req.body;
  const file = req.file;

  if (!category || !severity || !workflow_stage || !description) {
    return res.status(400).json({ error: 'category, severity, workflow_stage, and description are required' });
  }

  const validCategories = ['Bug', 'Suggestion', 'Feature Request', 'UI Issue'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
  }

  const validSeverities = ['Low', 'Medium', 'High', 'Critical'];
  if (!validSeverities.includes(severity)) {
    return res.status(400).json({ error: `Invalid severity. Must be one of: ${validSeverities.join(', ')}` });
  }

  const validStages = [
    'Registration',
    'Project Creation',
    'Blueprint Request',
    'Package Request',
    'Deliverable Download',
    'Support Ticket',
    'General'
  ];
  if (!validStages.includes(workflow_stage)) {
    return res.status(400).json({ error: `Invalid workflow stage. Must be one of: ${validStages.join(', ')}` });
  }

  try {
    const [inserted] = await db('pilot_feedback')
      .insert({
        organization_id: req.user.organization_id || null,
        user_id: req.user.id,
        category,
        severity,
        workflow_stage,
        description,
        screenshot_path: file ? `/uploads/${file.filename}` : null,
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');

    res.status(201).json(inserted);
  } catch (error) {
    next(error);
  }
};

export const getFeedbackList = async (req, res, next) => {
  if (!isStaffUser(req.user)) {
    return res.status(403).json({ error: 'Access denied. Staff only.' });
  }

  try {
    const feedback = await db('pilot_feedback as pf')
      .leftJoin('users as u', 'pf.user_id', 'u.id')
      .leftJoin('organizations as o', 'pf.organization_id', 'o.id')
      .select('pf.*', 'u.name as user_name', 'u.email as user_email', 'o.name as org_name')
      .orderBy('pf.created_at', 'desc');

    res.json(feedback);
  } catch (error) {
    next(error);
  }
};

export const getDashboardMetrics = async (req, res, next) => {
  if (!isStaffUser(req.user)) {
    return res.status(403).json({ error: 'Access denied. Staff only.' });
  }

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0,0,0,0);
    
    const startOfQuarter = new Date();
    const currentMonth = startOfQuarter.getMonth();
    startOfQuarter.setMonth(currentMonth - (currentMonth % 3));
    startOfQuarter.setDate(1);
    startOfQuarter.setHours(0,0,0,0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    // Core Counts
    const totalProjectsObj = await db('projects').where('deleted', false).count('id as count').first();
    const totalBlueprintsObj = await db('blueprint_requests').count('id as count').first();
    const totalPackagesObj = await db('package_requests').count('id as count').first();
    const totalDeliverablesObj = await db('deliverables').count('id as count').first();
    const totalDownloadsObj = await db('deliverable_downloads').count('id as count').first();
    const openTicketsObj = await db('support_tickets').whereNot({ status: 'closed' }).count('id as count').first();
    const closedTicketsObj = await db('support_tickets').where({ status: 'closed' }).count('id as count').first();

    // 1. Service Operations Metrics
    const pendingBlueprintsObj = await db('blueprint_requests').whereNot({ status: 'closed' }).count('id as count').first();
    const pendingPackagesObj = await db('package_requests').whereNot({ status: 'closed' }).count('id as count').first();

    const staffUsers = await db('users').whereIn('role', ['admin', 'blde_staff', 'ops', 'operations_manager', 'super_admin']).select('id', 'name');
    const staffWorkload = [];
    for (const s of staffUsers) {
      const bpCount = await db('blueprint_requests').where({ assigned_staff_id: s.id }).count('id as count').first();
      const pkgCount = await db('package_requests').where({ assigned_staff_id: s.id }).count('id as count').first();
      staffWorkload.push({
        staffId: s.id,
        name: s.name,
        blueprints: bpCount?.count || 0,
        packages: pkgCount?.count || 0,
        total: (bpCount?.count || 0) + (pkgCount?.count || 0)
      });
    }

    const blueprintsDelivered = await db('blueprint_requests').whereNotNull('received_at').select('created_at', 'received_at');
    const packagesDelivered = await db('package_requests').whereNotNull('received_at').select('created_at', 'received_at');
    let totalSecs = 0;
    let deliveryCount = 0;
    for (const r of [...blueprintsDelivered, ...packagesDelivered]) {
      const duration = new Date(r.received_at) - new Date(r.created_at);
      totalSecs += duration / 1000;
      deliveryCount++;
    }
    const avgDeliveryTimeSecs = deliveryCount > 0 ? totalSecs / deliveryCount : 0;
    const avgDeliveryTimeHours = avgDeliveryTimeSecs / 3600;

    const ticketsDelivered = await db('support_tickets').where({ status: 'closed' }).select('created_at', 'updated_at');
    let ticketSecs = 0;
    let ticketCount = 0;
    for (const t of ticketsDelivered) {
      const duration = new Date(t.updated_at) - new Date(t.created_at);
      ticketSecs += duration / 1000;
      ticketCount++;
    }
    const avgTicketResolutionTimeHours = ticketCount > 0 ? (ticketSecs / ticketCount) / 3600 : 0;

    const bpNear = await db('blueprint_requests').whereNot({ status: 'closed' }).whereBetween('estimated_completion_date', [now, threeDaysFromNow]).count('id as count').first();
    const pkgNear = await db('package_requests').whereNot({ status: 'closed' }).whereBetween('estimated_completion_date', [now, threeDaysFromNow]).count('id as count').first();
    const requestsNearDeadline = (bpNear?.count || 0) + (pkgNear?.count || 0);

    const bpOverdue = await db('blueprint_requests')
      .whereNot({ status: 'closed' })
      .where(function() {
        this.where('estimated_completion_date', '<', now)
            .orWhere(function() {
              this.whereNull('estimated_completion_date').andWhere('created_at', '<', sevenDaysAgo);
            });
      })
      .count('id as count').first();
      
    const pkgOverdue = await db('package_requests')
      .whereNot({ status: 'closed' })
      .where(function() {
        this.where('estimated_completion_date', '<', now)
            .orWhere(function() {
              this.whereNull('estimated_completion_date').andWhere('created_at', '<', sevenDaysAgo);
            });
      })
      .count('id as count').first();
      
    const overdueRequests = (bpOverdue?.count || 0) + (pkgOverdue?.count || 0);

    const bpMonth = await db('blueprint_requests').where({ status: 'delivered' }).where('received_at', '>=', startOfMonth).count('id as count').first();
    const pkgMonth = await db('package_requests').where({ status: 'delivered' }).where('received_at', '>=', startOfMonth).count('id as count').first();
    const deliveredThisMonth = (bpMonth?.count || 0) + (pkgMonth?.count || 0);
    
    const bpQuarter = await db('blueprint_requests').where({ status: 'delivered' }).where('received_at', '>=', startOfQuarter).count('id as count').first();
    const pkgQuarter = await db('package_requests').where({ status: 'delivered' }).where('received_at', '>=', startOfQuarter).count('id as count').first();
    const deliveredThisQuarter = (bpQuarter?.count || 0) + (pkgQuarter?.count || 0);

    const pendingDeliverablesObj = await db('deliverables as d')
      .leftJoin('deliverable_downloads as dd', 'd.id', 'dd.deliverable_id')
      .whereNull('dd.id')
      .count('d.id as count').first();

    // 2. Request Economics Metrics
    const orgRequests = [];
    const orgs = await db('organizations').select('id', 'name');
    for (const org of orgs) {
      const bpCount = await db('blueprint_requests').where({ organization_id: org.id }).count('id as count').first();
      const pkgCount = await db('package_requests').where({ organization_id: org.id }).count('id as count').first();
      orgRequests.push({
        organizationId: org.id,
        name: org.name,
        count: (bpCount?.count || 0) + (pkgCount?.count || 0)
      });
    }

    const userRequests = [];
    const users = await db('users').select('id', 'name', 'email').limit(100);
    for (const u of users) {
      const bpCount = await db('blueprint_requests').where({ submitted_by: u.id }).count('id as count').first();
      const pkgCount = await db('package_requests').where({ requested_by: u.id }).count('id as count').first();
      const total = (bpCount?.count || 0) + (pkgCount?.count || 0);
      if (total > 0) {
        userRequests.push({
          userId: u.id,
          name: u.name,
          email: u.email,
          count: total
        });
      }
    }
    userRequests.sort((a,b) => b.count - a.count);

    const downloadsPerDeliverable = [];
    const delivs = await db('deliverables').select('id', 'name', 'category');
    for (const d of delivs) {
      const countObj = await db('deliverable_downloads').where({ deliverable_id: d.id }).count('id as count').first();
      downloadsPerDeliverable.push({
        deliverableId: d.id,
        name: d.name,
        category: d.category,
        downloads: countObj?.count || 0
      });
    }

    const mostRequestedBlueprintTypes = await db('blueprint_requests')
      .select('template_type')
      .count('id as count')
      .groupBy('template_type')
      .orderBy('count', 'desc');
      
    const mostRequestedPackageTypes = await db('package_requests as pr')
      .leftJoin('projects as p', 'pr.project_id', 'p.id')
      .select('p.project_type')
      .count('pr.id as count')
      .groupBy('p.project_type')
      .orderBy('count', 'desc');

    const totalRequestsCount = (totalBlueprintsObj?.count || 0) + (totalPackagesObj?.count || 0);
    const avgDeliverablesPerRequest = totalRequestsCount > 0 ? (totalDeliverablesObj?.count || 0) / totalRequestsCount : 0;

    // 3. Customer Health Metrics (Last 30 Days)
    const loggedUsers = await db('activity_logs').where('created_at', '>=', thirtyDaysAgo).distinct('user_id');
    const usersActiveLast30Days = loggedUsers.length;
    
    const loggedOrgs = await db('activity_logs').where('created_at', '>=', thirtyDaysAgo).distinct('organization_id');
    const organizationsActiveLast30Days = loggedOrgs.length;
    
    const projectsCreatedLast30Days = await db('projects').where('created_at', '>=', thirtyDaysAgo).count('id as count').first().then(res => res?.count || 0);
    const deliverablesDownloadedLast30Days = await db('deliverable_downloads').where('downloaded_at', '>=', thirtyDaysAgo).count('id as count').first().then(res => res?.count || 0);
    const supportTicketsRaisedLast30Days = await db('support_tickets').where('created_at', '>=', thirtyDaysAgo).count('id as count').first().then(res => res?.count || 0);
    const feedbackSubmittedLast30Days = await db('pilot_feedback').where('created_at', '>=', thirtyDaysAgo).count('id as count').first().then(res => res?.count || 0);

    // 4. Startup KPI Reporting averages
    const blueprintsRated = await db('blueprint_requests').whereNotNull('rating').select('rating');
    const packagesRated = await db('package_requests').whereNotNull('rating').select('rating');
    let ratingSum = 0;
    let ratingCount = 0;
    for (const r of [...blueprintsRated, ...packagesRated]) {
      ratingSum += r.rating;
      ratingCount++;
    }
    const avgRating = ratingCount > 0 ? ratingSum / ratingCount : 0;

    const completedDeliverables = await db('blueprint_requests').where({ marked_as_received: true }).count('id as count').first()
      .then(async (bp) => {
        const pkg = await db('package_requests').where({ marked_as_received: true }).count('id as count').first();
        return (bp?.count || 0) + (pkg?.count || 0);
      });

    const mostRequestedDeliverableTypes = await db('deliverables')
      .select('category')
      .count('id as count')
      .groupBy('category')
      .orderBy('count', 'desc');

    const mostActiveOrgs = await db('blueprint_requests')
      .select('organization_id')
      .count('id as count')
      .groupBy('organization_id')
      .orderBy('count', 'desc')
      .limit(5)
      .then(async (rows) => {
        const list = [];
        for (const row of rows) {
          const org = await db('organizations').where({ id: row.organization_id }).first();
          if (org) {
            list.push({ organizationId: org.id, name: org.name, count: row.count });
          }
        }
        return list;
      });

    const mostActiveDepartments = await db('projects')
      .select('department')
      .count('id as count')
      .groupBy('department')
      .orderBy('count', 'desc')
      .limit(5);

    res.json({
      // Core counters
      totalProjects: totalProjectsObj?.count || 0,
      totalBlueprintRequests: totalBlueprintsObj?.count || 0,
      totalPackageRequests: totalPackagesObj?.count || 0,
      totalDeliverables: totalDeliverablesObj?.count || 0,
      totalDownloads: totalDownloadsObj?.count || 0,
      openTickets: openTicketsObj?.count || 0,
      closedTickets: closedTicketsObj?.count || 0,

      // Service Operations
      pendingBlueprintRequests: pendingBlueprintsObj?.count || 0,
      pendingPackageRequests: pendingPackagesObj?.count || 0,
      staffWorkloadDistribution: staffWorkload,
      averageDeliveryTimeHours: avgDeliveryTimeHours,
      averageTicketResolutionTimeHours: avgTicketResolutionTimeHours,
      requestsNearDeadline,
      overdueRequests,
      deliveredThisMonth,
      deliveredThisQuarter,
      pendingDeliverables: pendingDeliverablesObj?.count || 0,

      // Request Economics
      requestsPerOrganization: orgRequests,
      requestsPerUser: userRequests,
      downloadsPerDeliverable,
      mostRequestedBlueprintTypes,
      mostRequestedPackageTypes,
      averageDeliverablesPerRequest: avgDeliverablesPerRequest,

      // Customer Health
      organizationsActiveLast30Days,
      usersActiveLast30Days,
      projectsCreatedLast30Days,
      deliverablesDownloadedLast30Days,
      supportTicketsRaisedLast30Days,
      feedbackSubmittedLast30Days,

      // Startup KPIs
      completedDeliverables,
      averageRating: avgRating,
      mostRequestedDeliverableTypes,
      mostActiveOrganizations: mostActiveOrgs,
      mostActiveDepartments
    });
  } catch (error) {
    next(error);
  }
};

export const getMyFeedbackList = async (req, res, next) => {
  try {
    const list = await db('pilot_feedback as pf')
      .leftJoin('organizations as o', 'pf.organization_id', 'o.id')
      .select('pf.*', 'o.name as org_name')
      .where({ 'pf.user_id': req.user.id })
      .orderBy('pf.created_at', 'desc');
    res.json(list);
  } catch (error) {
    next(error);
  }
};

export const updateFeedbackStatus = async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!isStaffUser(req.user)) {
    return res.status(403).json({ error: 'Access denied. Staff only.' });
  }

  const validStatuses = ['pending', 'in_progress', 'resolved', 'rejected'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const trx = await db.transaction();
  try {
    const existing = await trx('pilot_feedback').where({ id }).first();
    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: 'Feedback record not found' });
    }

    await trx('pilot_feedback').where({ id }).update({
      status,
      updated_at: new Date()
    });

    await logActivity(trx, {
      organizationId: existing.organization_id,
      userId: req.user.id,
      entityType: 'feedback',
      entityId: existing.id,
      action: 'status_change',
      metadata: { from: existing.status || 'pending', to: status }
    });

    await trx.commit();
    res.json({ success: true, message: 'Feedback status updated successfully' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};


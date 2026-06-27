/**
 * Controlled Offline Sync & Central Support Hub Routes
 * BLDE EDC Clinical Research Platform - Phase 3 Compliance
 */

import express from 'express';
import { auth } from '../middleware/auth.js';
import { verifyOperatorReauth } from '../security/session_guard.js';
import { writeAuditLog } from '../security/audit_engine.js';
import { logger } from '../config/logger.js';
import db from '../db/connection.js';
import { env } from '../config/env.js';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Middleware to authenticate machine-to-machine requests using license keys
const authLicense = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. Missing or invalid license key header.' });
  }
  const licenseKey = authHeader.split(' ')[1];
  if (!licenseKey || !licenseKey.startsWith('BLDE-')) {
    return res.status(401).json({ error: 'Unauthorized. Invalid license key format.' });
  }
  req.licenseKey = licenseKey;
  next();
};

/**
 * Endpoint for client standalone machines to push blueprint requests.
 */
router.post('/support/sync/blueprint', authLicense, async (req, res) => {
  const { client_local_id, client_license_id, title, template_type, requirements, status } = req.body;

  try {
    const existing = await db('blueprint_requests')
      .where({ client_license_id, client_local_id })
      .first();

    if (existing) {
      await db('blueprint_requests')
        .where({ id: existing.id })
        .update({
          title: title || existing.title,
          template_type: template_type || existing.template_type,
          requirements: requirements || existing.requirements,
          status: status || existing.status,
          updated_at: new Date()
        });
      logger.info(`🔄 [CENTRAL SYNC] Updated blueprint request from client ${client_license_id} (local #${client_local_id})`);
    } else {
      await db('blueprint_requests')
        .insert({
          organization_id: 1, // Central organization maps support tickets to central dashboard
          submitted_by: 1, // Default to main supervisor user
          client_license_id,
          client_local_id,
          title: title || 'Untitled Blueprint',
          template_type: template_type || 'clinical_research',
          requirements: requirements || '',
          status: status || 'submitted',
          created_at: new Date(),
          updated_at: new Date()
        });
      logger.info(`✅ [CENTRAL SYNC] Created new blueprint request from client ${client_license_id} (local #${client_local_id})`);
    }

    res.json({ success: true });
  } catch (err) {
    logger.error(`❌ [CENTRAL SYNC ERROR] Blueprint sync failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint for client standalone machines to push package requests.
 */
router.post('/support/sync/package', authLicense, async (req, res) => {
  const { client_local_id, client_license_id, requirements, status } = req.body;

  try {
    const existing = await db('package_requests')
      .where({ client_license_id, client_local_id })
      .first();

    // On the central server, map to a default template project or create one
    let projectId = 1;
    const project = await db('projects').where('deleted', false).first();
    if (project) projectId = project.id;

    if (existing) {
      await db('package_requests')
        .where({ id: existing.id })
        .update({
          requirements: requirements || existing.requirements,
          status: status || existing.status,
          updated_at: new Date()
        });
      logger.info(`🔄 [CENTRAL SYNC] Updated package request from client ${client_license_id} (local #${client_local_id})`);
    } else {
      await db('package_requests')
        .insert({
          organization_id: 1,
          project_id: projectId,
          requested_by: 1,
          client_license_id,
          client_local_id,
          requirements: requirements || '',
          status: status || 'submitted',
          created_at: new Date(),
          updated_at: new Date()
        });
      logger.info(`✅ [CENTRAL SYNC] Created new package request from client ${client_license_id} (local #${client_local_id})`);
    }

    res.json({ success: true });
  } catch (err) {
    logger.error(`❌ [CENTRAL SYNC ERROR] Package sync failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint for client standalone machines to push support tickets.
 */
router.post('/support/sync/ticket', authLicense, async (req, res) => {
  const { client_local_id, client_license_id, title, description, priority, status } = req.body;

  try {
    const existing = await db('support_tickets')
      .where({ client_license_id, client_local_id })
      .first();

    if (existing) {
      await db('support_tickets')
        .where({ id: existing.id })
        .update({
          title: title || existing.title,
          description: description || existing.description,
          priority: priority || existing.priority,
          status: status || existing.status,
          updated_at: new Date()
        });
      logger.info(`🔄 [CENTRAL SYNC] Updated support ticket from client ${client_license_id} (local #${client_local_id})`);
    } else {
      await db('support_tickets')
        .insert({
          organization_id: 1,
          created_by: 1,
          client_license_id,
          client_local_id,
          title: title || 'Untitled Ticket',
          description: description || '',
          priority: priority || 'medium',
          status: status || 'open',
          created_at: new Date(),
          updated_at: new Date()
        });
      logger.info(`✅ [CENTRAL SYNC] Created new support ticket from client ${client_license_id} (local #${client_local_id})`);
    }

    res.json({ success: true });
  } catch (err) {
    logger.error(`❌ [CENTRAL SYNC ERROR] Ticket sync failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint for client standalone machines to push consultation tickets.
 */
router.post('/support/sync/consultation', authLicense, async (req, res) => {
  const {
    client_local_id, client_license_id, ticket_number, client_name, client_email,
    department, principal_investigator, project_title, expected_outcome,
    reference_pdf_filename, reference_pdf_content, additional_notes, status,
    blueprint_content, revision_notes, blueprint_filename, project_filename
  } = req.body;

  try {
    // Save reference PDF if sent as base64 string
    if (reference_pdf_content && reference_pdf_filename) {
      try {
        const uploadsDir = path.resolve(env.uploads.dir);
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const filePath = path.join(uploadsDir, reference_pdf_filename);
        fs.writeFileSync(filePath, Buffer.from(reference_pdf_content, 'base64'));
        logger.info(`📥 [CENTRAL SYNC] Saved synced reference PDF: ${reference_pdf_filename}`);
      } catch (writeErr) {
        logger.error(`❌ [CENTRAL SYNC ERROR] Failed to save synced PDF: ${writeErr.message}`);
      }
    }

    const existing = await db('consultation_tickets')
      .where({ client_license_id, client_local_id })
      .first();

    const ticketData = {
      ticket_number,
      client_name,
      client_email,
      department,
      principal_investigator,
      project_title,
      expected_outcome,
      reference_pdf_filename: reference_pdf_filename || null,
      additional_notes: additional_notes || '',
      status: status || 'submitted',
      blueprint_content: blueprint_content || null,
      revision_notes: revision_notes || null,
      blueprint_filename: blueprint_filename || null,
      project_filename: project_filename || null,
      updated_at: new Date()
    };

    if (existing) {
      await db('consultation_tickets')
        .where({ id: existing.id })
        .update(ticketData);
      logger.info(`🔄 [CENTRAL SYNC] Updated consultation ticket from client ${client_license_id} (local #${client_local_id})`);
    } else {
      await db('consultation_tickets')
        .insert({
          ...ticketData,
          client_license_id,
          client_local_id,
          created_at: new Date()
        });
      logger.info(`✅ [CENTRAL SYNC] Created new consultation ticket from client ${client_license_id} (local #${client_local_id})`);
    }

    res.json({ success: true });
  } catch (err) {
    logger.error(`❌ [CENTRAL SYNC ERROR] Consultation sync failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/support/sync/consultations', authLicense, async (req, res) => {
  const licenseId = req.query.licenseId;
  const email = req.query.email;
  if (!licenseId) {
    return res.status(400).json({ error: 'Missing licenseId parameter' });
  }

  try {
    let query = db('consultation_tickets')
      .where('client_license_id', licenseId);
      
    if (email) {
      query = query.where('client_email', email);
    }

    const tickets = await query.orderBy('created_at', 'desc');
    res.json(tickets);
  } catch (err) {
    logger.error(`❌ [CENTRAL SYNC ERROR] Consultations pull failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint for client standalone machines to poll/fetch deliverables for their license key.
 */
router.get('/support/sync/deliverables', authLicense, async (req, res) => {
  const licenseId = req.query.licenseId;
  if (!licenseId) {
    return res.status(400).json({ error: 'Missing licenseId parameter' });
  }

  try {
    // 1. Fetch deliverables linked to blueprints for this license
    const blueprintDeliverables = await db('deliverables as d')
      .join('blueprint_requests as br', function() {
        this.on('d.related_id', '=', 'br.id').andOn('d.related_type', '=', db.raw("'blueprint'"));
      })
      .select('d.*', 'br.client_local_id')
      .where('br.client_license_id', licenseId);

    // 2. Fetch deliverables linked to packages for this license
    const packageDeliverables = await db('deliverables as d')
      .join('package_requests as pr', function() {
        this.on('d.related_id', '=', 'pr.id').andOn('d.related_type', '=', db.raw("'package'"));
      })
      .select('d.*', 'pr.client_local_id')
      .where('pr.client_license_id', licenseId);

    const merged = [...blueprintDeliverables, ...packageDeliverables];
    res.json(merged);
  } catch (err) {
    logger.error(`❌ [CENTRAL SYNC ERROR] Deliverables fetch failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint for client standalone machines to download deliverable file binary.
 */
router.get('/support/sync/deliverable-file/:id', authLicense, async (req, res) => {
  const { id } = req.params;

  try {
    const deliverable = await db('deliverables').where({ id }).first();
    if (!deliverable) {
      return res.status(404).json({ error: 'Deliverable file not found' });
    }

    // Verify client access
    let request;
    if (deliverable.related_type === 'blueprint') {
      request = await db('blueprint_requests').where({ id: deliverable.related_id }).first();
    } else if (deliverable.related_type === 'package') {
      request = await db('package_requests').where({ id: deliverable.related_id }).first();
    }

    if (!request || request.client_license_id !== req.licenseKey) {
      return res.status(403).json({ error: 'Forbidden. This deliverable belongs to a different installation.' });
    }

    const rootPath = path.resolve(env.uploads.dir);
    const cleanFilename = deliverable.file_path.replace(/^\/uploads\//, '');
    const absoluteFilePath = path.join(rootPath, cleanFilename);

    if (!fs.existsSync(absoluteFilePath)) {
      return res.status(404).json({ error: 'Physical deliverable file not found on disk' });
    }

    res.sendFile(absoluteFilePath);
  } catch (err) {
    logger.error(`❌ [CENTRAL SYNC ERROR] Deliverable file fetch failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @api {post} /sync/import Offline Signed Data Package Import Stub
 * @apiDescription Enforces absolute localhost isolation and sync freeze.
 * Accepts signed package schemas for validation and logs attempts.
 */
router.post('/sync/import', auth, async (req, res) => {
  const { username, password, signedPackage } = req.body;

  try {
    // 1. Mandatory Part 11 Re-Authentication Gate
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'REAUTH_REQUIRED',
        message: 'Username and password reconfirmation is mandatory to attempt data package imports.'
      });
    }

    let authenticatedUser;
    try {
      authenticatedUser = await verifyOperatorReauth(username, password);
    } catch (authErr) {
      return res.status(401).json({
        success: false,
        error: 'REAUTH_FAILED',
        message: 'Re-authentication failed. Invalid administrator credentials.'
      });
    }

    // Only administrators or Principal Investigators can initiate sync stubs
    if (authenticatedUser.role !== 'admin' && authenticatedUser.role !== 'pi') {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_PRIVILEGES',
        message: 'Only administrators or Principal Investigators can perform data package audits.'
      });
    }

    // 2. Log access attempt in forensic audit trail
    await writeAuditLog({
      projectId: 1,
      userId: authenticatedUser.id,
      userName: authenticatedUser.email,
      action: 'SYNC_IMPORT_ATTEMPT',
      fieldName: 'signed_package_checksum',
      newValue: signedPackage ? (signedPackage.checksum || 'NO_CHECKSUM') : 'EMPTY_PKG'
    });

    // 3. Enforce Strict Offline Sync Freeze contract
    logger.warn(`[GxP COMPLIANCE] Blocked sync import attempt by ${authenticatedUser.email}. Live synchronization is frozen.`);

    return res.status(423).json({
      success: false,
      error: 'OFFLINE_SYNC_FREEZE',
      message: 'Clinical Operations isolation lock: Live network synchronization is frozen to preserve localhost clinical security. Physical offline import validation stubs are active.',
      diagnosticContract: {
        status: 'FROZEN',
        isolationMode: 'localhost-only',
        expectedPackageSchema: {
          manifest: {
            app_version: 'string',
            checksum_sha256: 'string',
            timestamp: 'string'
          },
          payload: {
            records: 'array',
            audit_trail: 'array'
          },
          signature: 'string'
        }
      }
    });

  } catch (err) {
    logger.error(`[SYNC ERROR] Fault inside sync import stub: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_SERVER_FAULT',
      message: err.message
    });
  }
});


/**
 * Endpoint for client standalone machines to push survey definition to central.
 */
router.post('/support/sync/survey-definition', authLicense, async (req, res) => {
  const {
    client_local_survey_id,
    client_license_id,
    survey_token,
    project_title,
    instrument_name,
    schema_json,
    active
  } = req.body;

  if (!client_local_survey_id || !client_license_id || !survey_token) {
    return res.status(400).json({ error: 'Missing required fields: client_local_survey_id, client_license_id, survey_token' });
  }

  try {
    const existing = await db('cloud_surveys')
      .where({ client_license_id, client_local_survey_id })
      .first();

    const payload = {
      survey_token,
      project_title: project_title || null,
      instrument_name: instrument_name || null,
      schema_json: typeof schema_json === 'object' ? JSON.stringify(schema_json) : schema_json || '[]',
      active: active !== undefined ? !!active : true,
      updated_at: new Date()
    };

    if (existing) {
      await db('cloud_surveys')
        .where({ id: existing.id })
        .update(payload);
      logger.info(`🔄 [CENTRAL SYNC] Updated cloud survey definition from client ${client_license_id} (local #${client_local_survey_id})`);
    } else {
      // Check if token is already taken by a different installation
      const tokenExists = await db('cloud_surveys').where({ survey_token }).first();
      if (tokenExists) {
        return res.status(409).json({ error: 'Survey token conflict. Please regenerate token.' });
      }

      await db('cloud_surveys')
        .insert({
          ...payload,
          client_license_id,
          client_local_survey_id,
          created_at: new Date()
        });
      logger.info(`✅ [CENTRAL SYNC] Created new cloud survey definition from client ${client_license_id} (local #${client_local_survey_id})`);
    }

    res.json({ success: true, survey_token });
  } catch (err) {
    logger.error(`❌ [CENTRAL SYNC ERROR] Survey definition sync failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint for client standalone machines to pull survey responses.
 */
router.get('/support/sync/survey-responses', authLicense, async (req, res) => {
  const licenseId = req.query.licenseId || req.licenseKey;
  if (!licenseId) {
    return res.status(400).json({ error: 'Missing licenseId parameter' });
  }

  try {
    const surveys = await db('cloud_surveys')
      .where('client_license_id', licenseId);

    if (surveys.length === 0) {
      return res.json([]);
    }

    const tokens = surveys.map(s => s.survey_token);

    const responses = await db('cloud_survey_responses')
      .whereIn('survey_token', tokens)
      .where({ synced: false })
      .orderBy('created_at', 'asc');

    res.json(responses);
  } catch (err) {
    logger.error(`❌ [CENTRAL SYNC ERROR] Survey responses pull failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint for client standalone machines to acknowledge pull of responses.
 */
router.post('/support/sync/survey-responses/ack', authLicense, async (req, res) => {
  const { responseIds } = req.body;

  if (!responseIds || !Array.isArray(responseIds)) {
    return res.status(400).json({ error: 'Missing or invalid responseIds array' });
  }

  try {
    const surveys = await db('cloud_surveys')
      .where('client_license_id', req.licenseKey);

    const tokens = new Set(surveys.map(s => s.survey_token));

    const responsesToAck = await db('cloud_survey_responses')
      .whereIn('id', responseIds);

    const validIds = [];
    for (const resp of responsesToAck) {
      if (tokens.has(resp.survey_token)) {
        validIds.push(resp.id);
      }
    }

    if (validIds.length > 0) {
      // Central server acts as pass-through: delete data upon acknowledgement
      await db('cloud_survey_responses')
        .whereIn('id', validIds)
        .delete();

      logger.info(`🗑️ [CENTRAL SYNC] Deleted/cleared ${validIds.length} survey responses from cloud buffer for license ${req.licenseKey}`);
    }

    res.json({ success: true, clearedCount: validIds.length });
  } catch (err) {
    logger.error(`❌ [CENTRAL SYNC ERROR] Survey responses ack failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;

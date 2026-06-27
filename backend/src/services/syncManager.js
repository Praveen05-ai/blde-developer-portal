import db from '../db/connection.js';
import { logger } from '../config/logger.js';
import { logActivity, createNotification } from '../utils/activity.js';
import { env } from '../config/env.js';
import fs from 'fs';
import path from 'path';
import { validateFileSignature } from '../utils/fileValidator.js';
import { recalculateCalculatedFields, triggerAlertRules } from '../controllers/recordController.js';

// Simulation of Central Server connectivity state (for integration testing)
let isCentralConnected = true;

// Mock license store
let cachedLicenseStatus = {
  valid: true,
  lastCheckIn: new Date(),
  licenseId: 'BLDE-SAAS-0001'
};

/**
 * Toggles connectivity to the simulated BLDE Central Support Server.
 */
export const setCentralConnectionState = (state) => {
  isCentralConnected = !!state;
  logger.info(`🌐 [SYNC MANAGER] Central support server connection state set to: ${isCentralConnected ? 'ONLINE' : 'OFFLINE'}`);
  return isCentralConnected;
};

/**
 * Checks current simulated connectivity.
 */
export const getCentralConnectionState = () => {
  return isCentralConnected;
};

/**
 * Handles communication with the central support server.
 */
const postToCentralServer = async (endpoint, payload) => {
  if (!isCentralConnected) {
    const err = new Error('ECONNREFUSED: Connection to BLDE Central Support Server refused.');
    err.code = 'ECONNREFUSED';
    throw err;
  }

  // If we are a client in standalone/university mode, connect to the real central server
  if (env.deploymentMode === 'standalone' || env.deploymentMode === 'university') {
    const url = `${env.centralSupportUrl}${endpoint}`;
    try {
      logger.info(`📡 [SYNC MANAGER] Connecting to Central Support Server: ${url}`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.licenseKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Central Support Server returned status ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (fetchErr) {
      logger.error(`❌ [SYNC MANAGER] Network trip failed: ${fetchErr.message}`);
      throw fetchErr;
    }
  }

  // Otherwise, simulate successful connection (SaaS/Server mode)
  return { success: true, receivedAt: new Date().toISOString() };
};

/**
 * Syncs a single entity (blueprint, package, ticket) to the central server.
 * If server is offline, marks the local record as sync_pending to defer syncing.
 */
export const syncEntityToCentral = async (entityType, entityId) => {
  let tableName = '';
  if (entityType === 'blueprint') tableName = 'blueprint_requests';
  else if (entityType === 'package') tableName = 'package_requests';
  else if (entityType === 'ticket') tableName = 'support_tickets';
  else if (entityType === 'consultation') tableName = 'consultation_tickets';
  else if (entityType === 'survey') tableName = 'survey_links';
  else throw new Error(`Unknown entity type: ${entityType}`);

  let record;
  if (entityType === 'survey') {
    record = await db('survey_links as s')
      .join('projects as p', 's.project_id', 'p.id')
      .join('instruments as i', 's.instrument_id', 'i.id')
      .select(
        's.*',
        'p.title as project_title',
        'i.name as instrument_name',
        'i.fields as instrument_fields'
      )
      .where('s.id', entityId)
      .first();
  } else {
    record = await db(tableName).where({ id: entityId }).first();
  }

  if (!record) {
    throw new Error(`${entityType} with ID ${entityId} not found.`);
  }

  try {
    const payload = {
      client_local_id: record.id,
      client_license_id: env.licenseKey,
      organization_id: record.organization_id || 1,
      status: record.status || 'active',
      updated_at: record.updated_at || record.created_at
    };

    if (entityType === 'blueprint') {
      payload.title = record.title || 'Untitled Blueprint';
      payload.template_type = record.template_type || 'clinical_research';
      payload.requirements = record.requirements || '';
      payload.priority = record.priority || 'Medium';
    } else if (entityType === 'package') {
      payload.project_id = record.project_id;
      payload.requirements = record.requirements || '';
      payload.priority = record.priority || 'Medium';
    } else if (entityType === 'ticket') {
      payload.title = record.title || 'Untitled Ticket';
      payload.description = record.description || '';
      payload.priority = record.priority || 'medium';
    } else if (entityType === 'survey') {
      payload.client_local_survey_id = record.id;
      payload.client_license_id = env.licenseKey;
      payload.survey_token = record.token;
      payload.project_title = record.project_title;
      payload.instrument_name = record.instrument_name;
      payload.schema_json = typeof record.instrument_fields === 'string'
        ? record.instrument_fields
        : JSON.stringify(record.instrument_fields || []);
      payload.active = !!record.active;
    } else if (entityType === 'consultation') {
      payload.ticket_number = record.ticket_number;
      payload.client_name = record.client_name;
      payload.client_email = record.client_email;
      payload.department = record.department;
      payload.principal_investigator = record.principal_investigator;
      payload.project_title = record.project_title;
      payload.expected_outcome = record.expected_outcome;
      payload.reference_pdf_filename = record.reference_pdf_filename;
      payload.additional_notes = record.additional_notes;
      payload.blueprint_content = record.blueprint_content;
      payload.revision_notes = record.revision_notes;
      payload.blueprint_filename = record.blueprint_filename;
      payload.project_filename = record.project_filename;

      if (record.reference_pdf_filename) {
        try {
          const filePath = path.join(path.resolve(env.uploads.dir), record.reference_pdf_filename);
          if (fs.existsSync(filePath)) {
            payload.reference_pdf_content = fs.readFileSync(filePath).toString('base64');
            logger.info(`📎 Attached PDF payload for sync: ${record.reference_pdf_filename}`);
          }
        } catch (pdfErr) {
          logger.error(`❌ Failed to attach PDF to sync: ${pdfErr.message}`);
        }
      }
    }

    // Attempt network sync
    if (entityType === 'survey') {
      await postToCentralServer('/api/support/sync/survey-definition', payload);
    } else {
      await postToCentralServer(`/api/support/sync/${entityType}`, payload);
    }

    // Mark as successfully synced
    await db(tableName)
      .where({ id: entityId })
      .update({
        sync_pending: false,
        last_sync_attempt: new Date(),
        sync_error: null
      });

    logger.info(`✅ [SYNC MANAGER] Synced ${entityType} #${entityId} to Central Support.`);
    return { synced: true };

  } catch (err) {
    logger.warn(`⚠️ [SYNC MANAGER] Central server offline. Queueing ${entityType} #${entityId} for deferred sync. Error: ${err.message}`);
    
    // Mark as pending
    await db(tableName)
      .where({ id: entityId })
      .update({
        sync_pending: true,
        last_sync_attempt: new Date(),
        sync_error: err.message
      });

    return { synced: false, queued: true, error: err.message };
  }
};

/**
 * Pulls new deliverables from the Central Support Server and updates local DB/storage.
 */
export const pullDeliverablesFromCentral = async () => {
  if (!isCentralConnected) {
    logger.warn('⚠️ [SYNC MANAGER] Cannot pull deliverables: Central Server connection is offline.');
    return { success: false, reason: 'CENTRAL_SERVER_OFFLINE' };
  }

  // Only standalone or university client installations pull deliverables from central support
  if (env.deploymentMode !== 'standalone' && env.deploymentMode !== 'university') {
    return { success: true, skipped: true };
  }

  try {
    const url = `${env.centralSupportUrl}/api/support/sync/deliverables?licenseId=${env.licenseKey}`;
    logger.info(`📡 [SYNC MANAGER] Pulling deliverables from: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${env.licenseKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Central Server returned status ${response.status}`);
    }

    const remoteDeliverables = await response.json();
    logger.info(`📥 [SYNC MANAGER] Found ${remoteDeliverables.length} remote deliverables.`);

    let downloadCount = 0;
    for (const d of remoteDeliverables) {
      // Check if we already have this deliverable locally
      const localExists = await db('deliverables')
        .where({ related_type: d.related_type, related_id: d.client_local_id, version: d.version })
        .first();

      if (localExists) {
        continue;
      }

      // Download physical file content
      const fileUrl = `${env.centralSupportUrl}/api/support/sync/deliverable-file/${d.id}`;
      logger.info(`📥 [SYNC MANAGER] Downloading deliverable file from: ${fileUrl}`);
      
      const fileResponse = await fetch(fileUrl, {
        headers: {
          'Authorization': `Bearer ${env.licenseKey}`
        }
      });

      if (!fileResponse.ok) {
        logger.error(`❌ [SYNC MANAGER] Failed to download file for deliverable #${d.id}`);
        continue;
      }

      const arrayBuffer = await fileResponse.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      // Perform magic number verification for security
      const { valid, mime } = validateFileSignature(fileBuffer, d.name);
      if (!valid) {
        logger.error(`❌ [SYNC MANAGER] Downloaded file signature check failed for: ${d.name}`);
        continue;
      }

      // Write physical file to local uploads folder
      const uniqueFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(d.name)}`;
      const localUploadsDir = path.resolve(env.uploads.dir);
      
      if (!fs.existsSync(localUploadsDir)) {
        fs.mkdirSync(localUploadsDir, { recursive: true });
      }
      
      const localFilePath = path.join(localUploadsDir, uniqueFilename);
      fs.writeFileSync(localFilePath, fileBuffer);

      const trx = await db.transaction();
      try {
        // Insert into local deliverables table
        const [inserted] = await trx('deliverables')
          .insert({
            organization_id: d.organization_id || 1,
            related_type: d.related_type,
            related_id: d.client_local_id, // Map back to local request ID
            uploaded_by: null, // Delivered by Central Support
            name: d.name,
            file_path: `/uploads/${uniqueFilename}`,
            file_size: d.file_size,
            checksum: d.checksum,
            version: d.version,
            delivery_notes: d.delivery_notes || 'Delivered automatically via BLDE Central Support.',
            category: d.category || 'Custom',
            mime_type: mime,
            created_at: new Date()
          })
          .returning('*');

        // Transition local request status to ready_for_delivery
        const tableName = d.related_type === 'blueprint' ? 'blueprint_requests' : 'package_requests';
        await trx(tableName)
          .where({ id: d.client_local_id })
          .update({ status: 'ready_for_delivery', updated_at: new Date() });

        // Create a local notification for the user
        let userId = 1; // Default fallback to Admin
        if (d.related_type === 'blueprint') {
          const req = await trx('blueprint_requests').where({ id: d.client_local_id }).first();
          if (req) userId = req.submitted_by;
        } else {
          const req = await trx('package_requests').where({ id: d.client_local_id }).first();
          if (req) userId = req.requested_by;
        }

        if (userId) {
          await createNotification(trx, {
            userId,
            title: 'New Deliverable Received',
            message: `Your requested ${d.related_type} deliverable "${d.name}" is now ready for download.`,
            relatedType: d.related_type,
            relatedId: d.client_local_id
          });
        }

        await logActivity(trx, {
          organizationId: d.organization_id || 1,
          userId,
          entityType: 'deliverable',
          entityId: inserted.id,
          action: 'upload',
          metadata: { name: d.name, version: d.version, size: d.file_size, source: 'central_sync' }
        });

        await trx.commit();
        downloadCount++;
        logger.info(`✅ [SYNC MANAGER] Successfully downloaded and integrated deliverable: ${d.name}`);

      } catch (innerErr) {
        await trx.rollback();
        try { fs.unlinkSync(localFilePath); } catch (_) {}
        logger.error(`❌ [SYNC MANAGER] Error committing deliverable to DB: ${innerErr.message}`);
      }
    }

    return { success: true, pulledCount: downloadCount };

  } catch (err) {
    logger.error(`❌ [SYNC MANAGER] Error pulling deliverables: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/**
 * Pulls new survey responses from the Central Server, inserts them locally, and clears the cloud buffer.
 */
export const pullSurveyResponsesFromCentral = async () => {
  if (!isCentralConnected) {
    logger.warn('⚠️ [SYNC MANAGER] Cannot pull survey responses: Central Server connection is offline.');
    return { success: false, reason: 'CENTRAL_SERVER_OFFLINE' };
  }

  // Only standalone or university client installations pull survey responses
  if (env.deploymentMode !== 'standalone' && env.deploymentMode !== 'university') {
    return { success: true, skipped: true };
  }

  try {
    const url = `${env.centralSupportUrl}/api/support/sync/survey-responses?licenseId=${env.licenseKey}`;
    logger.info(`📡 [SYNC MANAGER] Pulling survey responses from: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${env.licenseKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Central Server returned status ${response.status}`);
    }

    const remoteResponses = await response.json();
    logger.info(`📥 [SYNC MANAGER] Found ${remoteResponses.length} cloud survey responses.`);

    const pulledIds = [];
    let successCount = 0;

    for (const resp of remoteResponses) {
      const localSurvey = await db('survey_links')
        .where('token', resp.survey_token)
        .first();

      if (!localSurvey) {
        logger.warn(`⚠️ [SYNC MANAGER] Skipping response: local survey not found for token ${resp.survey_token}`);
        continue;
      }

      const trx = await db.transaction();
      try {
        const existingCount = await trx('records')
          .where('record_id', 'like', 'SURV-%')
          .count('id as count')
          .first();
        const count = parseInt(existingCount.count || 0) + 1;
        const record_id = `SURV-${String(count).padStart(4, '0')}`;

        let parsedData = typeof resp.response_data === 'string' 
          ? JSON.parse(resp.response_data) 
          : resp.response_data || {};

        parsedData = await recalculateCalculatedFields(trx, localSurvey.project_id, localSurvey.instrument_id, parsedData);
        const dataPayload = JSON.stringify(parsedData);

        await trx('records').insert({
          project_id: localSurvey.project_id,
          instrument_id: localSurvey.instrument_id,
          record_id,
          event_id: null,
          site_id: null,
          repeat_instance: 1,
          data: dataPayload,
          status: 'complete',
          entered_by: localSurvey.created_by || null,
          created_at: new Date(resp.created_at)
        });

        await trx('survey_links')
          .where({ id: localSurvey.id })
          .increment('responses', 1);

        await trx('audit_log').insert({
          project_id: localSurvey.project_id,
          record_id,
          instrument_id: localSurvey.instrument_id,
          user_id: localSurvey.created_by || null,
          user_name: 'Public Survey Respondent',
          action: 'SURVEY_SUBMITTED',
          new_value: `Cloud response synced. Responses count: ${localSurvey.responses + 1}`,
          ip_address: 'Central Cloud Sync'
        });

        await triggerAlertRules(trx, localSurvey.project_id, record_id, localSurvey.instrument_id, parsedData);

        await trx.commit();
        pulledIds.push(resp.id);
        successCount++;
        logger.info(`✅ [SYNC MANAGER] Successfully integrated cloud survey response for token: ${resp.survey_token}`);
      } catch (innerErr) {
        await trx.rollback();
        logger.error(`❌ [SYNC MANAGER] Error committing synced survey response to local DB: ${innerErr.message}`);
      }
    }

    if (pulledIds.length > 0) {
      logger.info(`📡 [SYNC MANAGER] Sending survey responses ack for ${pulledIds.length} records...`);
      const ackRes = await fetch(`${env.centralSupportUrl}/api/support/sync/survey-responses/ack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.licenseKey}`
        },
        body: JSON.stringify({ responseIds: pulledIds })
      });
      if (!ackRes.ok) {
        logger.error(`❌ [SYNC MANAGER] Acknowledging survey responses failed with status: ${ackRes.status}`);
      } else {
        logger.info(`✅ [SYNC MANAGER] Acknowledged and cleared ${pulledIds.length} survey responses on Central.`);
      }
    }

    return { success: true, pulledCount: successCount };
  } catch (err) {
    logger.error(`❌ [SYNC MANAGER] Error pulling survey responses: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/**
 * License Check-In Validation.
 * standalone/university modes verify license validity.
 */
export const performLicenseCheckIn = async (licenseId = env.licenseKey) => {
  try {
    const res = await postToCentralServer('/api/support/license-checkin', { licenseId });
    cachedLicenseStatus = {
      valid: true,
      lastCheckIn: new Date(),
      licenseId,
      error: null
    };
    logger.info(`🔑 [LICENSE CHECKIN] License ${licenseId} verified successfully.`);
    return cachedLicenseStatus;
  } catch (err) {
    logger.warn(`⚠️ [LICENSE CHECKIN] Central support server unreachable. Falling back to cached validation state. Error: ${err.message}`);
    cachedLicenseStatus.lastCheckIn = new Date();
    cachedLicenseStatus.error = `Connection failed: ${err.message}`;
    return cachedLicenseStatus;
  }
};

/**
 * Returns currently cached license validation status.
 */
export const getLicenseStatus = () => {
  return cachedLicenseStatus;
};

/**
 * Processes the queue of deferred offline transactions.
 * Iterates through blueprints, packages, and tickets flagged as sync_pending.
 */
export const processOfflineSyncQueue = async () => {
  logger.info('🔄 [SYNC MANAGER] Initiating offline sync queue reconciliation...');
  
  if (!isCentralConnected) {
    logger.warn('❌ [SYNC MANAGER] Sync queue reconciliation aborted: Central Server remains OFFLINE.');
    return { success: false, reason: 'CENTRAL_SERVER_OFFLINE', syncedCount: 0 };
  }

  let syncedCount = 0;
  const errors = [];

  const tables = [
    { type: 'blueprint', name: 'blueprint_requests' },
    { type: 'package', name: 'package_requests' },
    { type: 'ticket', name: 'support_tickets' },
    { type: 'consultation', name: 'consultation_tickets' },
    { type: 'survey', name: 'survey_links' }
  ];

  for (const table of tables) {
    try {
      const pendingRecords = await db(table.name).where({ sync_pending: true }).select('id');
      for (const record of pendingRecords) {
        const result = await syncEntityToCentral(table.type, record.id);
        if (result.synced) {
          syncedCount++;
        }
      }
    } catch (err) {
      errors.push({ table: table.name, error: err.message });
      logger.error(`❌ [SYNC MANAGER] Error processing sync queue for ${table.name}: ${err.message}`);
    }
  }

  logger.info(`🏁 [SYNC MANAGER] Sync reconciliation completed. Total synced: ${syncedCount}.`);
  
  // Also pull deliverables and survey responses from the central server
  const pullResult = await pullDeliverablesFromCentral();
  const surveyPullResult = await pullSurveyResponsesFromCentral();
  
  return {
    success: true,
    syncedCount,
    pulledCount: (pullResult.pulledCount || 0) + (surveyPullResult.pulledCount || 0),
    errors: errors.length > 0 ? errors : null
  };
};

export default {
  setCentralConnectionState,
  getCentralConnectionState,
  syncEntityToCentral,
  pullDeliverablesFromCentral,
  pullSurveyResponsesFromCentral,
  performLicenseCheckIn,
  getLicenseStatus,
  processOfflineSyncQueue
};

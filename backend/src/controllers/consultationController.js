import db from '../db/connection.js';
import { logger } from '../config/logger.js';
import { logFieldChange } from '../utils/audit.js';
import { env } from '../config/env.js';
import { syncEntityToCentral } from '../services/syncManager.js';

/**
 * Submits a new research consultation request.
 */
export const submitRequest = async (req, res, next) => {
  const { project_title, department, principal_investigator, expected_outcome, reference_pdf_filename, additional_notes } = req.body;

  if (!project_title || !expected_outcome) {
    return res.status(400).json({ error: 'Project Title and Expected Outcome are required' });
  }

  try {
    const ticketNumber = `CT-${Date.now().toString().slice(-8)}`;

    const [ticket] = await db('consultation_tickets')
      .insert({
        ticket_number: ticketNumber,
        client_name: req.user.name,
        client_email: req.user.email,
        department: department || 'General Medicine',
        principal_investigator: principal_investigator || req.user.name,
        project_title,
        expected_outcome,
        reference_pdf_filename: reference_pdf_filename || null,
        additional_notes: additional_notes || '',
        status: 'submitted'
      })
      .returning('*');

    await logFieldChange(db, {
      projectId: null,
      recordId: ticketNumber,
      action: 'RECORD_CREATED',
      newValue: `Consultation request submitted: ${project_title}`,
      ip: req.ip,
      userId: req.user.id,
      userName: req.user.name
    });

    // Try live sync to central server
    try {
      await syncEntityToCentral('consultation', ticket.id);
    } catch (syncErr) {
      logger.warn(`⚠️ [CONSULTATION CONTROL] Background sync failed during submit: ${syncErr.message}`);
    }

    res.status(201).json({ success: true, ticket_number: ticketNumber });
  } catch (error) {
    logger.error('Error submitting consultation request: ', error);
    next(error);
  }
};

/**
 * Returns list of requests.
 * Admins/Consultants see all tickets. Researchers see only their own.
 */
export const getRequests = async (req, res, next) => {
  // If running in client standalone or university mode, pull latest updates from central first
  if (env.deploymentMode === 'standalone' || env.deploymentMode === 'university') {
    try {
      const url = `${env.centralSupportUrl}/api/support/sync/consultations?licenseId=${env.licenseKey}&email=${encodeURIComponent(req.user.email)}`;
      logger.info(`📡 [CONSULTATION CONTROL] Pulling consultation updates from: ${url}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3-second timeout limit

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${env.licenseKey}`
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const remoteTickets = await response.json();
        logger.info(`📥 [CONSULTATION CONTROL] Received ${remoteTickets.length} tickets from Central.`);
        
        for (const t of remoteTickets) {
          if (t.client_local_id) {
            // Check if local ticket exists
            const localTicket = await db('consultation_tickets')
              .where({ id: t.client_local_id })
              .first();
            
            if (localTicket) {
              await db('consultation_tickets')
                .where({ id: t.client_local_id })
                .update({
                  status: t.status,
                  assigned_consultant_id: t.assigned_consultant_id,
                  assigned_statistician_id: t.assigned_statistician_id,
                  assigned_ai_engineer_id: t.assigned_ai_engineer_id,
                  assigned_db_operator_id: t.assigned_db_operator_id,
                  blueprint_content: t.blueprint_content,
                  revision_notes: t.revision_notes,
                  blueprint_filename: t.blueprint_filename,
                  project_filename: t.project_filename,
                  updated_at: new Date()
                });
            } else {
              // Self-healing insert if missing locally
              await db('consultation_tickets').insert({
                id: t.client_local_id,
                ticket_number: t.ticket_number,
                client_name: t.client_name,
                client_email: t.client_email,
                department: t.department,
                principal_investigator: t.principal_investigator,
                project_title: t.project_title,
                expected_outcome: t.expected_outcome,
                reference_pdf_filename: t.reference_pdf_filename,
                additional_notes: t.additional_notes,
                status: t.status,
                assigned_consultant_id: t.assigned_consultant_id,
                assigned_statistician_id: t.assigned_statistician_id,
                assigned_ai_engineer_id: t.assigned_ai_engineer_id,
                assigned_db_operator_id: t.assigned_db_operator_id,
                blueprint_content: t.blueprint_content,
                revision_notes: t.revision_notes,
                blueprint_filename: t.blueprint_filename,
                project_filename: t.project_filename,
                created_at: t.created_at,
                updated_at: t.updated_at
              });
            }
          }
        }
      } else {
        logger.error(`❌ [CONSULTATION CONTROL] Pull failed: HTTP ${response.status}`);
      }
    } catch (pullErr) {
      logger.warn(`⚠️ [CONSULTATION CONTROL] Failed to pull consultation tickets: ${pullErr.message}. Offline fallback active.`);
    }
  }

  try {
    let query = db('consultation_tickets as t')
      .leftJoin('consultants as c', 't.assigned_consultant_id', 'c.id')
      .leftJoin('consultants as s', 't.assigned_statistician_id', 's.id')
      .leftJoin('consultants as a', 't.assigned_ai_engineer_id', 'a.id')
      .leftJoin('consultants as d', 't.assigned_db_operator_id', 'd.id')
      .select(
        't.*',
        'c.name as consultant_name',
        's.name as statistician_name',
        'a.name as ai_engineer_name',
        'd.name as db_operator_name'
      );

    if (env.deploymentMode === 'standalone' || env.deploymentMode === 'university') {
      // In standalone/university client modes, always filter by the logged-in user's email
      query = query.where('t.client_email', req.user.email);
    } else if (req.user.role !== 'admin') {
      // In SaaS/Server mode, non-admins (researchers) only see their own tickets
      query = query.where('t.client_email', req.user.email);
    }

    const tickets = await query.orderBy('t.created_at', 'desc');
    res.json(tickets);
  } catch (error) {
    logger.error('Error getting consultation requests: ', error);
    next(error);
  }
};

/**
 * Returns list of registered consultants.
 */
export const getConsultants = async (req, res, next) => {
  try {
    const consultants = await db('consultants').where({ active: true });
    res.json(consultants);
  } catch (error) {
    logger.error('Error getting consultants: ', error);
    next(error);
  }
};

/**
 * Assigns a ticket to consultants/specialists and tracks due date.
 */
export const assignTicket = async (req, res, next) => {
  const { id } = req.params;
  const { assigned_consultant_id, assigned_statistician_id, assigned_ai_engineer_id, assigned_db_operator_id } = req.body;

  try {
    const ticket = await db('consultation_tickets').where({ id }).first();
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    await db('consultation_tickets')
      .where({ id })
      .update({
        assigned_consultant_id: assigned_consultant_id !== undefined ? assigned_consultant_id : ticket.assigned_consultant_id,
        assigned_statistician_id: assigned_statistician_id !== undefined ? assigned_statistician_id : ticket.assigned_statistician_id,
        assigned_ai_engineer_id: assigned_ai_engineer_id !== undefined ? assigned_ai_engineer_id : ticket.assigned_ai_engineer_id,
        assigned_db_operator_id: assigned_db_operator_id !== undefined ? assigned_db_operator_id : ticket.assigned_db_operator_id,
        status: 'assigned',
        updated_at: new Date()
      });

    await logFieldChange(db, {
      projectId: null,
      recordId: ticket.ticket_number,
      action: 'FIELD_CHANGED',
      fieldName: 'assigned_consultant_id',
      newValue: 'Ticket assigned to consultants',
      ip: req.ip,
      userId: req.user.id,
      userName: req.user.name
    });

    // Sync updates to central
    try {
      await syncEntityToCentral('consultation', ticket.id);
    } catch (e) {
      logger.warn('Deferred sync on assignment: ' + e.message);
    }

    res.json({ success: true, message: 'Ticket assigned successfully' });
  } catch (error) {
    logger.error('Error assigning ticket: ', error);
    next(error);
  }
};

/**
 * Uploads a deliverable file (.bldebp or .bldeproj) to a ticket.
 */
export const uploadDeliverable = async (req, res, next) => {
  const { id } = req.params;
  const { type, content, revision_notes } = req.body; // type is 'blueprint' or 'project'

  if (!type || !content) {
    return res.status(400).json({ error: 'Deliverable type and content are required' });
  }

  try {
    const ticket = await db('consultation_tickets').where({ id }).first();
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const updates = {
      updated_at: new Date()
    };

    if (type === 'blueprint') {
      updates.blueprint_content = content;
      updates.status = 'blueprint_ready';
    } else if (type === 'project') {
      updates.project_filename = content; // Stores the encrypted base64 payload string directly
      updates.status = 'setup_delivered';
    }

    if (revision_notes) {
      updates.revision_notes = revision_notes;
    }

    await db('consultation_tickets')
      .where({ id })
      .update(updates);

    await logFieldChange(db, {
      projectId: null,
      recordId: ticket.ticket_number,
      action: 'FIELD_CHANGED',
      fieldName: 'deliverables',
      newValue: `Uploaded ${type} deliverable`,
      ip: req.ip,
      userId: req.user.id,
      userName: req.user.name
    });

    // Sync updates to central
    try {
      await syncEntityToCentral('consultation', ticket.id);
    } catch (e) {
      logger.warn('Deferred sync on deliverable upload: ' + e.message);
    }

    res.json({ success: true, message: 'Deliverable uploaded successfully' });
  } catch (error) {
    logger.error('Error uploading deliverable: ', error);
    next(error);
  }
};

/**
 * Updates status of a ticket.
 */
export const updateTicketStatus = async (req, res, next) => {
  const { id } = req.params;
  const { status, revision_notes } = req.body;

  try {
    const ticket = await db('consultation_tickets').where({ id }).first();
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const updates = {
      status,
      updated_at: new Date()
    };

    if (revision_notes !== undefined) {
      updates.revision_notes = revision_notes;
    }

    await db('consultation_tickets')
      .where({ id })
      .update(updates);

    await logFieldChange(db, {
      projectId: null,
      recordId: ticket.ticket_number,
      action: 'FIELD_CHANGED',
      fieldName: 'status',
      newValue: status,
      ip: req.ip,
      userId: req.user.id,
      userName: req.user.name
    });

    // Sync updates to central
    try {
      await syncEntityToCentral('consultation', ticket.id);
    } catch (e) {
      logger.warn('Deferred sync on status update: ' + e.message);
    }

    res.json({ success: true, message: `Status updated to ${status}` });
  } catch (error) {
    logger.error('Error updating status: ', error);
    next(error);
  }
};

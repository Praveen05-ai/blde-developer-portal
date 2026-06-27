import db from '../db/connection.js';
import { logger } from '../config/logger.js';
import { logFieldChange } from '../utils/audit.js';
import { logActivity, createNotification } from '../utils/activity.js';
import { syncEntityToCentral } from '../services/syncManager.js';

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
// 1. BLUEPRINT REQUESTS
// ==========================================

export const createBlueprintRequest = async (req, res, next) => {
  const { project_id, title, template_type, requirements, status } = req.body;

  if (!title || !template_type || !requirements) {
    return res.status(400).json({ error: 'Title, template type, and requirements are required' });
  }

  const organization_id = req.user.organization_id;
  if (!organization_id) {
    return res.status(400).json({ error: 'User does not belong to an organization' });
  }

  const trx = await db.transaction();
  try {
    const [blueprint] = await trx('blueprint_requests')
      .insert({
        organization_id,
        project_id: project_id || null,
        submitted_by: req.user.id,
        title,
        template_type,
        requirements,
        status: status || 'draft',
        assigned_staff_id: null
      })
      .returning('*');

    const isSubmitted = (status || 'draft') === 'submitted';
    await logActivity(trx, {
      organizationId: organization_id,
      userId: req.user.id,
      entityType: 'blueprint',
      entityId: blueprint.id,
      action: isSubmitted ? 'submit' : 'create',
      metadata: { title, status: blueprint.status }
    });

    if (isSubmitted) {
      await createNotification(trx, {
        userId: req.user.id,
        title: 'Blueprint Request Submitted',
        message: `Your blueprint request "${title}" has been submitted successfully.`,
        relatedType: 'blueprint',
        relatedId: blueprint.id
      });
    }

    await trx.commit();
    try {
      await syncEntityToCentral('blueprint', blueprint.id);
    } catch (_) {}
    logger.info(`Blueprint request "${title}" created by ${req.user.email} (Org: ${organization_id})`);
    res.status(201).json(blueprint);
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const getBlueprintRequests = async (req, res, next) => {
  try {
    let queryBuilder = db('blueprint_requests as br')
      .leftJoin('projects as p', 'br.project_id', 'p.id')
      .leftJoin('users as u1', 'br.submitted_by', 'u1.id')
      .leftJoin('users as u2', 'br.assigned_staff_id', 'u2.id')
      .select(
        'br.*',
        'p.title as project_title',
        'u1.name as submitter_name',
        'u1.email as submitter_email',
        'u2.name as assigned_staff_name'
      );

    // Isolation: Staff can see all. Tenant users and admins see only their own org.
    if (!isStaffUser(req.user) && !isCentralAdmin(req.user)) {
      queryBuilder = queryBuilder.where('br.organization_id', req.user.organization_id);
    }

    // Horizontal Isolation: If not staff, they can only see requests they submitted
    if (!isStaffUser(req.user)) {
      queryBuilder = queryBuilder.where('br.submitted_by', req.user.id);
    }

    const blueprints = await queryBuilder.orderBy('br.created_at', 'desc');
    res.json(blueprints);
  } catch (error) {
    next(error);
  }
};

export const getBlueprintRequestById = async (req, res, next) => {
  const { id } = req.params;
  try {
    const blueprint = await db('blueprint_requests as br')
      .leftJoin('projects as p', 'br.project_id', 'p.id')
      .leftJoin('users as u1', 'br.submitted_by', 'u1.id')
      .leftJoin('users as u2', 'br.assigned_staff_id', 'u2.id')
      .select(
        'br.*',
        'p.title as project_title',
        'u1.name as submitter_name',
        'u1.email as submitter_email',
        'u2.name as assigned_staff_name'
      )
      .where('br.id', id)
      .first();

    if (!blueprint) {
      return res.status(404).json({ error: 'Blueprint request not found' });
    }

    // Tenancy Check: cross-organization boundaries
    if (!isStaffUser(req.user) && !isCentralAdmin(req.user) && blueprint.organization_id !== req.user.organization_id) {
      return res.status(403).json({ error: 'Access forbidden. Cross-organization boundaries.' });
    }

    // Horizontal Isolation: If not staff, verify they submitted it
    if (!isStaffUser(req.user) && blueprint.submitted_by !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden. You did not submit this blueprint request.' });
    }

    res.json(blueprint);
  } catch (error) {
    next(error);
  }
};

export const updateBlueprintRequest = async (req, res, next) => {
  const { id } = req.params;
  const { 
    title, template_type, requirements, status, assigned_staff_id,
    estimated_completion_date, priority, effort_estimate, internal_progress_notes
  } = req.body;

  const trx = await db.transaction();
  try {
    const existing = await trx('blueprint_requests').where({ id }).first();
    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: 'Blueprint request not found' });
    }

    // Isolation Check
    if (!isStaffUser(req.user) && !isCentralAdmin(req.user) && existing.organization_id !== req.user.organization_id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access denied' });
    }

    // Role check constraints:
    // If researcher: cannot edit unless status is 'draft', or submitting it.
    if (!isStaffUser(req.user) && existing.status !== 'draft' && status !== 'submitted') {
      await trx.rollback();
      return res.status(400).json({ error: 'Cannot modify a submitted blueprint request' });
    }

    // Workflow transition validation:
    if (status && status !== existing.status) {
      const VALID_BLUEPRINT_TRANSITIONS = {
        draft: ['draft', 'submitted'],
        submitted: ['submitted', 'assigned', 'requirement_review', 'closed'],
        assigned: ['assigned', 'requirement_review', 'working', 'closed'],
        requirement_review: ['requirement_review', 'working', 'assigned', 'closed'],
        working: ['working', 'internal_review', 'requirement_review', 'closed'],
        internal_review: ['internal_review', 'ready_for_delivery', 'working', 'closed'],
        ready_for_delivery: ['ready_for_delivery', 'delivered', 'internal_review', 'closed'],
        delivered: ['delivered', 'closed', 'ready_for_delivery'],
        closed: ['closed', 'submitted', 'draft']
      };

      const allowed = VALID_BLUEPRINT_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(status)) {
        await trx.rollback();
        return res.status(400).json({ error: `Invalid status transition from '${existing.status}' to '${status}'` });
      }
    }

    const updateData = { updated_at: new Date() };
    if (title !== undefined) updateData.title = title;
    if (template_type !== undefined) updateData.template_type = template_type;
    if (requirements !== undefined) updateData.requirements = requirements;
    if (status !== undefined) updateData.status = status;
    
    // Only support staff can assign staff
    if (assigned_staff_id !== undefined) {
      if (!isStaffUser(req.user)) {
        await trx.rollback();
        return res.status(403).json({ error: 'Only administrators can assign staff' });
      }
      updateData.assigned_staff_id = assigned_staff_id || null;
    }

    // Only staff can update internal work columns
    if (isStaffUser(req.user)) {
      if (estimated_completion_date !== undefined) updateData.estimated_completion_date = estimated_completion_date || null;
      if (priority !== undefined) updateData.priority = priority;
      if (effort_estimate !== undefined) updateData.effort_estimate = effort_estimate || null;
      if (internal_progress_notes !== undefined) updateData.internal_progress_notes = internal_progress_notes || null;
    }

    await trx('blueprint_requests').where({ id }).update(updateData);

    // 1. Status Change Log and Notification
    if (status && status !== existing.status) {
      await logActivity(trx, {
        organizationId: existing.organization_id,
        userId: req.user.id,
        entityType: 'blueprint',
        entityId: existing.id,
        action: status === 'closed' ? 'close' : 'status_change',
        metadata: { from: existing.status, to: status }
      });

      await createNotification(trx, {
        userId: existing.submitted_by,
        title: status === 'closed' ? 'Blueprint Request Closed' : 'Blueprint Request Status Changed',
        message: `Your blueprint request "${existing.title}" is now "${status.replace(/_/g, ' ')}".`,
        relatedType: 'blueprint',
        relatedId: existing.id
      });
    }

    // 2. Assignment History Log and Notification
    if (assigned_staff_id !== undefined && assigned_staff_id !== existing.assigned_staff_id) {
      const newStaffId = assigned_staff_id ? parseInt(assigned_staff_id) : null;
      if (newStaffId !== existing.assigned_staff_id) {
        await trx('assignment_history').insert({
          request_type: 'blueprint',
          request_id: existing.id,
          assigned_by: req.user.id,
          assigned_to: newStaffId,
          reason: req.body.assignment_reason || 'Staff assignment updated',
          created_at: new Date()
        });

        await logActivity(trx, {
          organizationId: existing.organization_id,
          userId: req.user.id,
          entityType: 'blueprint',
          entityId: existing.id,
          action: 'assign',
          metadata: { assigned_to: newStaffId }
        });

        // Notify investigator
        await createNotification(trx, {
          userId: existing.submitted_by,
          title: 'Specialist Assigned',
          message: `A specialist has been assigned to your blueprint request "${existing.title}".`,
          relatedType: 'blueprint',
          relatedId: existing.id
        });

        // Notify assigned staff
        if (newStaffId) {
          await createNotification(trx, {
            userId: newStaffId,
            title: 'New Blueprint Assigned',
            message: `You have been assigned to blueprint request "${existing.title}".`,
            relatedType: 'blueprint',
            relatedId: existing.id
          });
        }
      }
    }

    await logFieldChange(trx, {
      projectId: existing.project_id,
      userId: req.user.id,
      userName: req.user.name,
      action: 'BLUEPRINT_UPDATED',
      newValue: `Status: ${status || existing.status}, Assigned: ${assigned_staff_id || existing.assigned_staff_id}`,
      ip: req.ip
    });

    await trx.commit();
    try {
      await syncEntityToCentral('blueprint', id);
    } catch (_) {}
    logger.info(`Blueprint request ${id} updated by ${req.user.email}`);
    res.json({ success: true, message: 'Blueprint request updated successfully' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};


// ==========================================
// 2. PACKAGE REQUESTS
// ==========================================

export const createPackageRequest = async (req, res, next) => {
  const { project_id, requirements, status } = req.body;

  if (!project_id || !requirements) {
    return res.status(400).json({ error: 'Project ID and requirements are required' });
  }

  const organization_id = req.user.organization_id;
  if (!organization_id) {
    return res.status(400).json({ error: 'User does not belong to an organization' });
  }

  const trx = await db.transaction();
  try {
    // Verify project belongs to organization
    const project = await trx('projects').where({ id: project_id, organization_id }).first();
    if (!project) {
      await trx.rollback();
      return res.status(400).json({ error: 'Invalid project ID or access denied' });
    }

    const [packageReq] = await trx('package_requests')
      .insert({
        organization_id,
        project_id,
        requested_by: req.user.id,
        requirements,
        status: status || 'draft',
        assigned_staff_id: null
      })
      .returning('*');

    const isSubmitted = (status || 'draft') === 'submitted';
    await logActivity(trx, {
      organizationId: organization_id,
      userId: req.user.id,
      entityType: 'package',
      entityId: packageReq.id,
      action: isSubmitted ? 'submit' : 'create',
      metadata: { project_title: project.title, project_id, status: packageReq.status }
    });

    if (isSubmitted) {
      await createNotification(trx, {
        userId: req.user.id,
        title: 'Package Request Submitted',
        message: `Your package request for project "${project.title}" has been submitted successfully.`,
        relatedType: 'package',
        relatedId: packageReq.id
      });
    }

    await trx.commit();
    try {
      await syncEntityToCentral('package', packageReq.id);
    } catch (_) {}
    logger.info(`Package request created by ${req.user.email} (Project: ${project_id})`);
    res.status(201).json(packageReq);
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const getPackageRequests = async (req, res, next) => {
  try {
    let queryBuilder = db('package_requests as pr')
      .leftJoin('projects as p', 'pr.project_id', 'p.id')
      .leftJoin('users as u1', 'pr.requested_by', 'u1.id')
      .leftJoin('users as u2', 'pr.assigned_staff_id', 'u2.id')
      .select(
        'pr.*',
        'p.title as project_title',
        'u1.name as requester_name',
        'u1.email as requester_email',
        'u2.name as assigned_staff_name'
      );

    if (!isStaffUser(req.user) && !isCentralAdmin(req.user)) {
      queryBuilder = queryBuilder.where('pr.organization_id', req.user.organization_id);
    }

    // Horizontal Isolation: If not staff, restrict to their own requests
    if (!isStaffUser(req.user)) {
      queryBuilder = queryBuilder.where('pr.requested_by', req.user.id);
    }

    const packages = await queryBuilder.orderBy('pr.created_at', 'desc');
    res.json(packages);
  } catch (error) {
    next(error);
  }
};

export const getPackageRequestById = async (req, res, next) => {
  const { id } = req.params;
  try {
    const packageReq = await db('package_requests as pr')
      .leftJoin('projects as p', 'pr.project_id', 'p.id')
      .leftJoin('users as u1', 'pr.requested_by', 'u1.id')
      .leftJoin('users as u2', 'pr.assigned_staff_id', 'u2.id')
      .select(
        'pr.*',
        'p.title as project_title',
        'u1.name as requester_name',
        'u1.email as requester_email',
        'u2.name as assigned_staff_name'
      )
      .where('pr.id', id)
      .first();

    if (!packageReq) {
      return res.status(404).json({ error: 'Package request not found' });
    }

    // Tenancy Check: cross-organization boundaries
    if (!isStaffUser(req.user) && !isCentralAdmin(req.user) && packageReq.organization_id !== req.user.organization_id) {
      return res.status(403).json({ error: 'Access forbidden. Cross-organization boundaries.' });
    }

    // Horizontal Isolation: If not staff, check ownership
    if (!isStaffUser(req.user) && packageReq.requested_by !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden. You did not request this package.' });
    }

    res.json(packageReq);
  } catch (error) {
    next(error);
  }
};

export const updatePackageRequest = async (req, res, next) => {
  const { id } = req.params;
  const { 
    requirements, status, assigned_staff_id,
    estimated_completion_date, priority, effort_estimate, internal_progress_notes
  } = req.body;

  const trx = await db.transaction();
  try {
    const existing = await trx('package_requests').where({ id }).first();
    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: 'Package request not found' });
    }

    if (!isStaffUser(req.user) && !isCentralAdmin(req.user) && existing.organization_id !== req.user.organization_id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access denied' });
    }

    // Role check constraints:
    if (!isStaffUser(req.user) && existing.status !== 'draft' && status !== 'submitted') {
      await trx.rollback();
      return res.status(400).json({ error: 'Cannot modify a submitted package request' });
    }

    // Workflow transition validation:
    if (status && status !== existing.status) {
      const VALID_PACKAGE_TRANSITIONS = {
        draft: ['draft', 'submitted'],
        submitted: ['submitted', 'assigned', 'requirement_review', 'closed'],
        assigned: ['assigned', 'requirement_review', 'working', 'closed'],
        requirement_review: ['requirement_review', 'working', 'assigned', 'closed'],
        working: ['working', 'internal_review', 'requirement_review', 'closed'],
        internal_review: ['internal_review', 'ready_for_delivery', 'working', 'closed'],
        ready_for_delivery: ['ready_for_delivery', 'delivered', 'internal_review', 'closed'],
        delivered: ['delivered', 'closed', 'ready_for_delivery'],
        closed: ['closed', 'submitted', 'draft']
      };

      const allowed = VALID_PACKAGE_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(status)) {
        await trx.rollback();
        return res.status(400).json({ error: `Invalid status transition from '${existing.status}' to '${status}'` });
      }
    }

    const updateData = { updated_at: new Date() };
    if (requirements !== undefined) updateData.requirements = requirements;
    if (status !== undefined) updateData.status = status;

    // Only support staff can assign staff
    if (assigned_staff_id !== undefined) {
      if (!isStaffUser(req.user)) {
        await trx.rollback();
        return res.status(403).json({ error: 'Only administrators can assign staff' });
      }
      updateData.assigned_staff_id = assigned_staff_id || null;
    }

    // Only staff can update internal work columns
    if (isStaffUser(req.user)) {
      if (estimated_completion_date !== undefined) updateData.estimated_completion_date = estimated_completion_date || null;
      if (priority !== undefined) updateData.priority = priority;
      if (effort_estimate !== undefined) updateData.effort_estimate = effort_estimate || null;
      if (internal_progress_notes !== undefined) updateData.internal_progress_notes = internal_progress_notes || null;
    }

    await trx('package_requests').where({ id }).update(updateData);

    // 1. Status Change Log and Notification
    if (status && status !== existing.status) {
      await logActivity(trx, {
        organizationId: existing.organization_id,
        userId: req.user.id,
        entityType: 'package',
        entityId: existing.id,
        action: status === 'closed' ? 'close' : 'status_change',
        metadata: { from: existing.status, to: status }
      });

      await createNotification(trx, {
        userId: existing.requested_by,
        title: status === 'closed' ? 'Package Request Closed' : 'Package Request Status Changed',
        message: `Your package request #${existing.id} is now "${status.replace(/_/g, ' ')}".`,
        relatedType: 'package',
        relatedId: existing.id
      });
    }

    // 2. Assignment History Log and Notification
    if (assigned_staff_id !== undefined && assigned_staff_id !== existing.assigned_staff_id) {
      const newStaffId = assigned_staff_id ? parseInt(assigned_staff_id) : null;
      if (newStaffId !== existing.assigned_staff_id) {
        await trx('assignment_history').insert({
          request_type: 'package',
          request_id: existing.id,
          assigned_by: req.user.id,
          assigned_to: newStaffId,
          reason: req.body.assignment_reason || 'Staff assignment updated',
          created_at: new Date()
        });

        await logActivity(trx, {
          organizationId: existing.organization_id,
          userId: req.user.id,
          entityType: 'package',
          entityId: existing.id,
          action: 'assign',
          metadata: { assigned_to: newStaffId }
        });

        // Notify investigator
        await createNotification(trx, {
          userId: existing.requested_by,
          title: 'Specialist Assigned',
          message: `A specialist has been assigned to your package request #${existing.id}.`,
          relatedType: 'package',
          relatedId: existing.id
        });

        // Notify assigned staff
        if (newStaffId) {
          await createNotification(trx, {
            userId: newStaffId,
            title: 'New Package Assigned',
            message: `You have been assigned to package request #${existing.id}.`,
            relatedType: 'package',
            relatedId: existing.id
          });
        }
      }
    }

    await logFieldChange(trx, {
      projectId: existing.project_id,
      userId: req.user.id,
      userName: req.user.name,
      action: 'PACKAGE_REQUEST_UPDATED',
      newValue: `Status: ${status || existing.status}, Assigned: ${assigned_staff_id || existing.assigned_staff_id}`,
      ip: req.ip
    });

    await trx.commit();
    try {
      await syncEntityToCentral('package', id);
    } catch (_) {}
    logger.info(`Package request ${id} updated by ${req.user.email}`);
    res.json({ success: true, message: 'Package request updated successfully' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};


// ==========================================
// 3. SUPPORT TICKETS
// ==========================================

export const createSupportTicket = async (req, res, next) => {
  const { title, description, priority } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: 'Title and description are required' });
  }

  const organization_id = req.user.organization_id;
  if (!organization_id) {
    return res.status(400).json({ error: 'User does not belong to an organization' });
  }

  const trx = await db.transaction();
  try {
    const [ticket] = await trx('support_tickets')
      .insert({
        organization_id,
        created_by: req.user.id,
        title,
        description,
        priority: priority || 'medium',
        status: 'open'
      })
      .returning('*');

    await logActivity(trx, {
      organizationId: organization_id,
      userId: req.user.id,
      entityType: 'ticket',
      entityId: ticket.id,
      action: 'create',
      metadata: { title, priority: ticket.priority }
    });

    await createNotification(trx, {
      userId: req.user.id,
      title: 'Support Ticket Opened',
      message: `Your support ticket "${title}" has been opened successfully.`,
      relatedType: 'ticket',
      relatedId: ticket.id
    });

    await trx.commit();
    try {
      await syncEntityToCentral('ticket', ticket.id);
    } catch (_) {}
    logger.info(`Support ticket "${title}" opened by ${req.user.email}`);
    res.status(201).json(ticket);
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const getSupportTickets = async (req, res, next) => {
  try {
    let queryBuilder = db('support_tickets as st')
      .leftJoin('users as u1', 'st.created_by', 'u1.id')
      .select(
        'st.*',
        'u1.name as creator_name',
        'u1.email as creator_email'
      );

    if (!isStaffUser(req.user) && !isCentralAdmin(req.user)) {
      queryBuilder = queryBuilder.where('st.organization_id', req.user.organization_id);
    }

    // Horizontal Isolation: If not staff, restrict to their own tickets
    if (!isStaffUser(req.user)) {
      queryBuilder = queryBuilder.where('st.created_by', req.user.id);
    }

    const tickets = await queryBuilder.orderBy('st.created_at', 'desc');
    res.json(tickets);
  } catch (error) {
    next(error);
  }
};

export const getSupportTicketById = async (req, res, next) => {
  const { id } = req.params;
  try {
    const ticket = await db('support_tickets as st')
      .leftJoin('users as u1', 'st.created_by', 'u1.id')
      .select(
        'st.*',
        'u1.name as creator_name',
        'u1.email as creator_email'
      )
      .where('st.id', id)
      .first();

    if (!ticket) {
      return res.status(404).json({ error: 'Support ticket not found' });
    }

    // Tenancy Check: cross-organization boundaries
    if (!isStaffUser(req.user) && !isCentralAdmin(req.user) && ticket.organization_id !== req.user.organization_id) {
      return res.status(403).json({ error: 'Access forbidden. Cross-organization boundaries.' });
    }

    // Horizontal Isolation: If not staff, check ownership
    if (!isStaffUser(req.user) && ticket.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden. You did not create this support ticket.' });
    }

    res.json(ticket);
  } catch (error) {
    next(error);
  }
};

export const updateSupportTicket = async (req, res, next) => {
  const { id } = req.params;
  const { title, description, priority, status } = req.body;

  const trx = await db.transaction();
  try {
    const existing = await trx('support_tickets').where({ id }).first();
    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: 'Support ticket not found' });
    }

    if (!isStaffUser(req.user) && !isCentralAdmin(req.user) && existing.organization_id !== req.user.organization_id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access denied' });
    }

    const updateData = { updated_at: new Date() };
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (priority !== undefined) updateData.priority = priority;
    if (status !== undefined) updateData.status = status;

    await trx('support_tickets').where({ id }).update(updateData);

    if (status && status !== existing.status) {
      await logActivity(trx, {
        organizationId: existing.organization_id,
        userId: req.user.id,
        entityType: 'ticket',
        entityId: existing.id,
        action: status === 'closed' ? 'close' : 'status_change',
        metadata: { from: existing.status, to: status }
      });

      await createNotification(trx, {
        userId: existing.created_by,
        title: status === 'closed' ? 'Support Ticket Closed' : 'Support Ticket Status Changed',
        message: `Your support ticket #${existing.id} status has been updated to "${status}".`,
        relatedType: 'ticket',
        relatedId: existing.id
      });
    }

    await logFieldChange(trx, {
      projectId: null,
      userId: req.user.id,
      userName: req.user.name,
      action: 'TICKET_UPDATED',
      newValue: `Status: ${status || existing.status}, Priority: ${priority || existing.priority}`,
      ip: req.ip
    });

    await trx.commit();
    try {
      await syncEntityToCentral('ticket', id);
    } catch (_) {}
    logger.info(`Support ticket ${id} updated by ${req.user.email}`);
    res.json({ success: true, message: 'Support ticket updated successfully' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};


// ==========================================
// 4. COMMUNICATIONS
// ==========================================

export const createCommunication = async (req, res, next) => {
  const { related_type, related_id, message, attachment_path } = req.body;

  if (!related_type || !related_id || !message) {
    return res.status(400).json({ error: 'related_type, related_id, and message are required' });
  }

  const validTypes = ['blueprint', 'package', 'ticket'];
  if (!validTypes.includes(related_type)) {
    return res.status(400).json({ error: 'Invalid related_type. Must be: blueprint, package, or ticket' });
  }

  const organization_id = req.user.organization_id;
  if (!organization_id) {
    return res.status(400).json({ error: 'User does not belong to an organization' });
  }

  const trx = await db.transaction();
  try {
    // Check access to target record
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
      return res.status(404).json({ error: `Related ${related_type} not found` });
    }

    if (!isCentralAdmin(req.user) && targetRecord.organization_id !== organization_id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access denied to this request workflow' });
    }

    const [comm] = await trx('communications')
      .insert({
        organization_id: targetRecord.organization_id, // Pin to target's organization id
        related_type,
        related_id,
        sender_id: req.user.id,
        message,
        attachment_path: attachment_path || null
      })
      .returning('*');

    // Notify other party
    let recipientId = null;
    if (req.user.role === 'admin') {
      recipientId = targetRecord.submitted_by || targetRecord.requested_by || targetRecord.created_by;
    } else {
      recipientId = targetRecord.assigned_staff_id || null;
    }

    if (recipientId) {
      await createNotification(trx, {
        userId: recipientId,
        title: `New Reply on ${related_type.toUpperCase()} #${related_id}`,
        message: `${req.user.name} sent: "${message.slice(0, 50)}${message.length > 50 ? '...' : ''}"`,
        relatedType: related_type,
        relatedId: related_id
      });
    }

    await logActivity(trx, {
      organizationId: targetRecord.organization_id,
      userId: req.user.id,
      entityType: related_type,
      entityId: related_id,
      action: 'reply',
      metadata: { message_snippet: message.slice(0, 60) }
    });

    await trx.commit();
    res.status(201).json(comm);
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const getCommunications = async (req, res, next) => {
  const { type, id } = req.params;

  if (!type || !id) {
    return res.status(400).json({ error: 'Type and ID are required' });
  }

  const validTypes = ['blueprint', 'package', 'ticket'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }

  const organization_id = req.user.organization_id;

  try {
    // Check isolation
    let targetRecord;
    if (type === 'blueprint') {
      targetRecord = await db('blueprint_requests').where({ id }).first();
    } else if (type === 'package') {
      targetRecord = await db('package_requests').where({ id }).first();
    } else if (type === 'ticket') {
      targetRecord = await db('support_tickets').where({ id }).first();
    }

    if (!targetRecord) {
      return res.status(404).json({ error: `Target ${type} not found` });
    }

    if (!isStaffUser(req.user) && !isCentralAdmin(req.user) && targetRecord.organization_id !== organization_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await db('communications as c')
      .leftJoin('users as u', 'c.sender_id', 'u.id')
      .select('c.*', 'u.name as sender_name', 'u.role as sender_role')
      .where({ 'c.related_type': type, 'c.related_id': id })
      .orderBy('c.created_at', 'asc');

    res.json(messages);
  } catch (error) {
    next(error);
  }
};

export const uploadCommunicationAttachment = async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ attachment_path: `/uploads/${req.file.filename}`, filename: req.file.originalname });
};

export const markBlueprintReceived = async (req, res, next) => {
  const { id } = req.params;
  const { rating, useful, feedback_text } = req.body;
  
  if (rating === undefined || useful === undefined) {
    return res.status(400).json({ error: 'rating and useful boolean are required' });
  }

  const trx = await db.transaction();
  try {
    const existing = await trx('blueprint_requests').where({ id }).first();
    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: 'Blueprint request not found' });
    }

    if (!isCentralAdmin(req.user) && existing.organization_id !== req.user.organization_id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access denied' });
    }

    // Must be in ready_for_delivery or delivered status
    if (existing.status !== 'ready_for_delivery' && existing.status !== 'delivered') {
      await trx.rollback();
      return res.status(400).json({ error: 'Request is not in delivery status' });
    }

    await trx('blueprint_requests').where({ id }).update({
      status: 'delivered', // transition to delivered
      marked_as_received: true,
      received_at: new Date(),
      rating: parseInt(rating),
      useful: !!useful,
      feedback_text: feedback_text || null,
      updated_at: new Date()
    });

    await logActivity(trx, {
      organizationId: existing.organization_id,
      userId: req.user.id,
      entityType: 'blueprint',
      entityId: existing.id,
      action: 'receive',
      metadata: { rating, useful }
    });

    await trx.commit();
    try {
      await syncEntityToCentral('blueprint', id);
    } catch (_) {}
    res.json({ success: true, message: 'Blueprint deliverable successfully marked as received.' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const markPackageReceived = async (req, res, next) => {
  const { id } = req.params;
  const { rating, useful, feedback_text } = req.body;
  
  if (rating === undefined || useful === undefined) {
    return res.status(400).json({ error: 'rating and useful boolean are required' });
  }

  const trx = await db.transaction();
  try {
    const existing = await trx('package_requests').where({ id }).first();
    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: 'Package request not found' });
    }

    if (!isCentralAdmin(req.user) && existing.organization_id !== req.user.organization_id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access denied' });
    }

    // Must be in ready_for_delivery or delivered status
    if (existing.status !== 'ready_for_delivery' && existing.status !== 'delivered') {
      await trx.rollback();
      return res.status(400).json({ error: 'Request is not in delivery status' });
    }

    await trx('package_requests').where({ id }).update({
      status: 'delivered', // transition to delivered
      marked_as_received: true,
      received_at: new Date(),
      rating: parseInt(rating),
      useful: !!useful,
      feedback_text: feedback_text || null,
      updated_at: new Date()
    });

    await logActivity(trx, {
      organizationId: existing.organization_id,
      userId: req.user.id,
      entityType: 'package',
      entityId: existing.id,
      action: 'receive',
      metadata: { rating, useful }
    });

    await trx.commit();
    try {
      await syncEntityToCentral('package', id);
    } catch (_) {}
    res.json({ success: true, message: 'Package deliverable successfully marked as received.' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};


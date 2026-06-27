import db from '../db/connection.js';
import { logger } from '../config/logger.js';
import { logFieldChange } from '../utils/audit.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '../config/env.js';

import { logActivity } from '../utils/activity.js';

// --- PROJECTS ---
export const createProject = async (req, res, next) => {
  const { title, description, status, longitudinal, randomisation_enabled, multi_site, department, guide_name, project_type, dde_enabled } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Project title is required' });
  }

  const trx = await db.transaction();
  try {
    const [project] = await trx('projects')
      .insert({
        title,
        description: description || null,
        status: status || 'draft',
        longitudinal: !!longitudinal,
        randomisation_enabled: !!randomisation_enabled,
        multi_site: !!multi_site,
        dde_enabled: !!dde_enabled,
        created_by: req.user.id,
        organization_id: req.user.organization_id || null,
        department: department || null,
        guide_name: guide_name || null,
        project_type: project_type || 'Custom Project'
      })
      .returning('*');

    await logFieldChange(trx, {
      projectId: project.id,
      userId: req.user.id,
      userName: req.user.name,
      action: 'PROJECT_CREATED',
      newValue: title,
      ip: req.ip
    });

    await logActivity(trx, {
      organizationId: req.user.organization_id,
      userId: req.user.id,
      entityType: 'project',
      entityId: project.id,
      action: 'create',
      metadata: { title }
    });

    await trx.commit();
    logger.info(`Project created: "${title}" by user ${req.user.email}`);
    res.status(201).json(project);
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const getProjects = async (req, res, next) => {
  try {
    let queryBuilder = db('projects as p')
      .leftJoin('users as u', 'p.created_by', 'u.id')
      .where('p.deleted', false)
      .select('p.*', 'u.name as creator');

    if (req.user.organization_id) {
      queryBuilder = queryBuilder.where('p.organization_id', req.user.organization_id);
    }

    if (req.user.role !== 'admin') {
      // Return projects the user created or projects they are mapped to view
      queryBuilder = queryBuilder.where(function() {
        this.where('p.created_by', req.user.id)
            .orWhereIn('p.id', function() {
              this.select('project_id').from('project_users').where({ user_id: req.user.id, can_view: true });
            });
      });
    }

    const projects = await queryBuilder.orderBy('p.created_at', 'desc');
    res.json(projects);
  } catch (error) {
    next(error);
  }
};

export const getProjectById = async (req, res, next) => {
  const { id } = req.params;
  try {
    const project = await db('projects as p')
      .leftJoin('users as u', 'p.created_by', 'u.id')
      .where('p.id', id)
      .where('p.deleted', false)
      .select('p.*', 'u.name as creator')
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Tenancy Check: cross-organization boundaries
    if (req.user.organization_id && project.organization_id !== req.user.organization_id) {
      return res.status(403).json({ error: 'Access forbidden. Cross-organization boundaries.' });
    }

    // Horizontal Isolation: Check if user is authorized to view this project
    const userRole = req.user.role ? req.user.role.toLowerCase() : '';
    const isStaff = ['admin', 'blde_staff', 'ops', 'operations_manager', 'super_admin'].includes(userRole);
    
    if (!isStaff && project.created_by !== req.user.id) {
      const assigned = await db('project_users')
        .where({ project_id: id, user_id: req.user.id, can_view: true })
        .first();
      
      if (!assigned) {
        return res.status(403).json({ error: 'Access forbidden. You are not assigned to this project.' });
      }
    }

    res.json(project);
  } catch (error) {
    next(error);
  }
};


export const updateProject = async (req, res, next) => {
  const { id } = req.params;
  const { title, description, status, longitudinal, randomisation_enabled, multi_site, department, guide_name, project_type, dde_enabled } = req.body;

  try {
    const existing = await db('projects')
      .where({ id })
      .where('deleted', false)
      .first();

    if (!existing) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Tenancy Check
    if (req.user.organization_id && existing.organization_id !== req.user.organization_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (longitudinal !== undefined) updateData.longitudinal = !!longitudinal;
    if (randomisation_enabled !== undefined) updateData.randomisation_enabled = !!randomisation_enabled;
    if (multi_site !== undefined) updateData.multi_site = !!multi_site;
    if (dde_enabled !== undefined) updateData.dde_enabled = !!dde_enabled;
    if (department !== undefined) updateData.department = department;
    if (guide_name !== undefined) updateData.guide_name = guide_name;
    if (project_type !== undefined) updateData.project_type = project_type;
    updateData.updated_at = new Date();

    await db('projects')
      .where({ id })
      .update(updateData);

    logger.info(`Project ${id} updated by ${req.user.email}`);
    res.json({ success: true, message: 'Project updated successfully' });
  } catch (error) {
    next(error);
  }
};

// --- SITES (DAGs) ---
export const createSite = async (req, res, next) => {
  const { pid } = req.params;
  const { name, code, city, pi_name, pi_email } = req.body;

  if (!name || !code) {
    return res.status(400).json({ error: 'Site name and code are required' });
  }

  const trx = await db.transaction();
  try {
    const existingSite = await trx('sites')
      .where({ project_id: pid })
      .whereRaw('LOWER(code) = ?', [code.toLowerCase()])
      .first();
    if (existingSite) {
      await trx.rollback();
      return res.status(400).json({ error: `A site with code "${code.toUpperCase()}" already exists in this project.` });
    }

    const [site] = await trx('sites')
      .insert({
        project_id: pid,
        name,
        code: code.toUpperCase(),
        city: city || null,
        pi_name: pi_name || null,
        pi_email: pi_email || null,
        active: true
      })
      .returning('*');

    await logFieldChange(trx, {
      projectId: pid,
      userId: req.user.id,
      userName: req.user.name,
      action: 'SITE_CREATED',
      newValue: `${site.code}: ${site.name}`,
      ip: req.ip
    });

    await trx.commit();
    logger.info(`Site "${site.code}" created for project ${pid} by ${req.user.email}`);
    res.status(201).json(site);
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const getSites = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const sites = await db('sites')
      .where({ project_id: pid })
      .orderBy('code', 'asc');
    res.json(sites);
  } catch (error) {
    next(error);
  }
};

export const assignUser = async (req, res, next) => {
  const { pid } = req.params;
  const { user_id, site_id, can_view, can_edit, can_delete, can_export, can_manage } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const trx = await db.transaction();
  try {
    // 1. Map user in project_users
    await trx('project_users')
      .insert({
        project_id: pid,
        user_id,
        can_view: can_view !== undefined ? !!can_view : true,
        can_edit: !!can_edit,
        can_delete: !!can_delete,
        can_export: !!can_export,
        can_manage: !!can_manage
      })
      .onConflict(['project_id', 'user_id'])
      .merge();

    // 2. Set site_id directly in user profile for validation
    if (site_id !== undefined) {
      await trx('users')
        .where({ id: user_id })
        .update({ site_id: site_id || null });
    }

    await logFieldChange(trx, {
      projectId: pid,
      userId: req.user.id,
      userName: req.user.name,
      action: 'USER_ASSIGNED',
      newValue: `user:${user_id}|site:${site_id || 'none'}`,
      ip: req.ip
    });

    await trx.commit();
    res.json({ success: true, message: 'User assigned successfully' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

// --- INSTRUMENTS ---
export const getInstruments = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const instruments = await db('instruments')
      .where({ project_id: pid })
      .orderBy('created_at', 'asc');
    
    // Parse JSON configurations safely
    const parsed = instruments.map(inst => ({
      ...inst,
      fields: typeof inst.fields === 'string' ? JSON.parse(inst.fields) : inst.fields
    }));
    
    res.json(parsed);
  } catch (error) {
    next(error);
  }
};

export const createInstrument = async (req, res, next) => {
  const { pid } = req.params;
  const { name, description, fields, repeating } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Instrument name is required' });
  }

  try {
    const fieldsPayload = fields ? (typeof fields === 'string' ? fields : JSON.stringify(fields)) : '[]';
    
    const [instrument] = await db('instruments')
      .insert({
        project_id: pid,
        name,
        description: description || null,
        fields: fieldsPayload,
        repeating: !!repeating
      })
      .returning('*');

    res.status(201).json({
      ...instrument,
      fields: JSON.parse(fieldsPayload)
    });
  } catch (error) {
    next(error);
  }
};

export const updateInstrument = async (req, res, next) => {
  const { pid, id } = req.params;
  const { name, description, fields, repeating } = req.body;

  try {
    const existing = await db('instruments')
      .where({ id, project_id: pid })
      .first();

    if (!existing) {
      return res.status(404).json({ error: 'Instrument not found' });
    }

    // Seal control: published versions cannot be directly modified
    if (existing.status === 'published') {
      return res.status(403).json({ error: 'Published instruments are sealed and cannot be modified directly.' });
    }

    const fieldsPayload = fields ? (typeof fields === 'string' ? fields : JSON.stringify(fields)) : existing.fields;

    const [updated] = await db('instruments')
      .where({ id, project_id: pid })
      .update({
        name: name || existing.name,
        description: description !== undefined ? description : existing.description,
        fields: fieldsPayload,
        repeating: repeating !== undefined ? !!repeating : existing.repeating
      })
      .returning('*');

    res.json({
      ...updated,
      fields: JSON.parse(fieldsPayload)
    });
  } catch (error) {
    next(error);
  }
};

export const publishInstrument = async (req, res, next) => {
  const { pid, id } = req.params;
  const trx = await db.transaction();

  try {
    const existing = await db('instruments')
      .transacting(trx)
      .where({ id, project_id: pid })
      .first();

    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: 'Instrument not found' });
    }

    if (existing.status === 'published') {
      await trx.rollback();
      return res.status(400).json({ error: 'Instrument is already published' });
    }

    // Update status to published
    await trx('instruments')
      .where({ id })
      .update({
        status: 'published',
        published_at: new Date()
      });

    await logFieldChange(trx, {
      projectId: pid,
      userId: req.user.id,
      userName: req.user.name,
      action: 'INSTRUMENT_PUBLISHED',
      newValue: `instrument:${id}|name:${existing.name}`,
      ip: req.ip
    });

    await trx.commit();
    logger.info(`Instrument published and sealed: "${existing.name}" (ID: ${id})`);
    res.json({ success: true, message: 'Instrument published and sealed successfully' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const getProjectPermissions = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const perms = await db('project_users as pu')
      .join('users as u', 'pu.user_id', 'u.id')
      .select('pu.*', 'u.name', 'u.email')
      .where('pu.project_id', pid);
    res.json(perms);
  } catch (error) {
    next(error);
  }
};

export const revokeProjectPermission = async (req, res, next) => {
  const { pid, uid } = req.params;
  const trx = await db.transaction();
  try {
    await trx('project_users')
      .where({ project_id: pid, user_id: uid })
      .del();

    await logFieldChange(trx, {
      projectId: pid,
      userId: req.user.id,
      userName: req.user.name,
      action: 'USER_REVOKED',
      newValue: `user:${uid}`,
      ip: req.ip
    });

    await trx.commit();
    res.json({ success: true, message: 'Permission revoked successfully' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

// --- EVENTS ---
export const getEvents = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const events = await db('events')
      .where({ project_id: pid })
      .orderBy('sort_order', 'asc');
    res.json(events);
  } catch (error) {
    next(error);
  }
};

export const createEvent = async (req, res, next) => {
  const { pid } = req.params;
  const { name, day_offset, window_before, window_after, description, sort_order } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Event name is required' });
  }

  try {
    const [event] = await db('events')
      .insert({
        project_id: pid,
        name,
        day_offset: day_offset || 0,
        window_before: window_before || 0,
        window_after: window_after || 0,
        description: description || null,
        sort_order: sort_order || 0
      })
      .returning('*');
    res.status(201).json(event);
  } catch (error) {
    next(error);
  }
};

export const deleteEvent = async (req, res, next) => {
  const { pid, id } = req.params;
  try {
    await db('events')
      .where({ id, project_id: pid })
      .del();
    res.json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// --- VISIT SCHEDULE ---
export const getPatientSchedule = async (req, res, next) => {
  const { pid, rid } = req.params;
  try {
    const events = await db('events').where({ project_id: pid }).orderBy('sort_order', 'asc');
    const patientEvents = await db('patient_events').where({ project_id: pid, record_id: rid });

    const schedule = events.map(ev => {
      const pe = patientEvents.find(p => p.event_id === ev.id);
      return {
        ...ev,
        patient_event: pe || null
      };
    });
    res.json(schedule);
  } catch (error) {
    next(error);
  }
};

export const schedulePatientEvent = async (req, res, next) => {
  const { pid } = req.params;
  const { record_id, event_id, scheduled_date, status, notes } = req.body;

  if (!record_id || !event_id) {
    return res.status(400).json({ error: 'record_id and event_id are required' });
  }

  try {
    const projectEvents = await db('events').where({ project_id: pid }).orderBy('id', 'asc');
    if (projectEvents.length > 0 && parseInt(event_id) !== projectEvents[0].id) {
      const baseline = await db('patient_events')
        .where({ project_id: pid, record_id, event_id: projectEvents[0].id })
        .first();
      if (baseline && baseline.scheduled_date && scheduled_date) {
        if (new Date(scheduled_date) < new Date(baseline.scheduled_date)) {
          return res.status(400).json({ error: 'Cannot schedule follow-up visit before the baseline assessment date.' });
        }
      }
    }

    const existing = await db('patient_events')
      .where({ project_id: pid, record_id, event_id })
      .first();

    if (existing) {
      const [updated] = await db('patient_events')
        .where({ id: existing.id })
        .update({
          scheduled_date: scheduled_date || existing.scheduled_date,
          status: status || existing.status,
          notes: notes !== undefined ? notes : existing.notes
        })
        .returning('*');
      res.json(updated);
    } else {
      const [inserted] = await db('patient_events')
        .insert({
          project_id: pid,
          record_id,
          event_id,
          scheduled_date,
          status: status || 'scheduled',
          notes: notes || null
        })
        .returning('*');
      res.status(201).json(inserted);
    }
  } catch (error) {
    next(error);
  }
};

export const runReport = async (req, res, next) => {
  const { pid } = req.params;
  const { filters, instrument_id, status, date_from, date_to } = req.body;

  try {
    let queryBuilder = db('records as r')
      .leftJoin('instruments as i', 'r.instrument_id', 'i.id')
      .leftJoin('sites as s', 'r.site_id', 's.id')
      .select(
        'r.*',
        'i.name as instrument_name',
        's.code as site_code'
      )
      .where('r.project_id', pid);

    // Site DAG Enforcement: Non-admins can only see records for their mapped site
    if (req.user.role !== 'admin' && req.user.site_id) {
      queryBuilder = queryBuilder.where(function() {
        this.where('r.site_id', req.user.site_id).orWhereNull('r.site_id');
      });
    }

    // Role-based visibility enforcement for Data Entry Operator:
    // Can only run reports for records entered by themselves.
    if (req.user.role === 'data_entry' || req.user.role === 'student') {
      queryBuilder = queryBuilder.where('r.entered_by', req.user.id);
    }

    if (instrument_id) {
      queryBuilder = queryBuilder.where('r.instrument_id', instrument_id);
    }
    if (status) {
      queryBuilder = queryBuilder.where('r.status', status);
    }
    if (date_from) {
      queryBuilder = queryBuilder.where('r.created_at', '>=', date_from);
    }
    if (date_to) {
      queryBuilder = queryBuilder.where('r.created_at', '<=', date_to);
    }

    const records = await queryBuilder.orderBy('r.created_at', 'desc');

    const parsed = records.map(r => ({
      ...r,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data || {}
    }));

    // Apply inline field filters if present in filters array
    let filteredRows = parsed;
    if (Array.isArray(filters) && filters.length > 0) {
      filteredRows = parsed.filter(row => {
        return filters.every(f => {
          if (!f.field) return true;
          const val = String(row.data[f.field] ?? '');
          const target = String(f.value ?? '');
          
          if (f.operator === '=') return val === target;
          if (f.operator === '!=') return val !== target;
          if (f.operator === '>') return parseFloat(val) > parseFloat(target);
          if (f.operator === '<') return parseFloat(val) < parseFloat(target);
          if (f.operator === 'contains') return val.toLowerCase().includes(target.toLowerCase());
          return true;
        });
      });
    }

    res.json({ rows: filteredRows });
  } catch (error) {
    next(error);
  }
};

export const getStats = async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const userId = req.user.id;
    const siteId = req.user.site_id;

    let projectCountQuery = db('projects').where({ deleted: false });
    let recordCountQuery = db('records');
    let completeCountQuery = db('records').where({ status: 'complete' });
    let siteCountQuery = db('sites');

    if (!isAdmin) {
      const visibleProjectIds = db('projects')
        .where({ deleted: false })
        .where(function() {
          this.where('created_by', userId)
              .orWhereIn('id', db('project_users').where({ user_id: userId, can_view: true }).select('project_id'));
        })
        .select('id');

      projectCountQuery = projectCountQuery.whereIn('id', visibleProjectIds);
      
      // If user is tied to a site (DAG isolation)
      if (siteId) {
        recordCountQuery = recordCountQuery.whereIn('project_id', visibleProjectIds).where('site_id', siteId);
        completeCountQuery = completeCountQuery.whereIn('project_id', visibleProjectIds).where('site_id', siteId);
        siteCountQuery = siteCountQuery.where('id', siteId);
      } else {
        recordCountQuery = recordCountQuery.whereIn('project_id', visibleProjectIds);
        completeCountQuery = completeCountQuery.whereIn('project_id', visibleProjectIds);
        siteCountQuery = siteCountQuery.whereIn('project_id', visibleProjectIds);
      }

      if (req.user.role === 'data_entry' || req.user.role === 'student') {
        recordCountQuery = recordCountQuery.where('entered_by', userId);
        completeCountQuery = completeCountQuery.where('entered_by', userId);
      }
    }

    const projectsCount = await projectCountQuery.count('* as count').first().then(r => parseInt(r.count || 0));
    const recordsCount = await recordCountQuery.count('* as count').first().then(r => parseInt(r.count || 0));
    const completeCount = await completeCountQuery.count('* as count').first().then(r => parseInt(r.count || 0));
    const sitesCount = await siteCountQuery.count('* as count').first().then(r => parseInt(r.count || 0));
    
    const requesterRole = (req.user.role || '').toLowerCase();
    let usersQuery = db('users');
    
    if (requesterRole === 'admin') {
      if (req.user.organization_id) {
        usersQuery = usersQuery.where('organization_id', req.user.organization_id);
      }
    } else if (requesterRole === 'pi' || requesterRole === 'project_incharge') {
      usersQuery = usersQuery.andWhere(function() {
        this.where('id', req.user.id)
            .orWhere('created_by', req.user.id)
            .orWhereIn('id', function() {
              this.select('user_id')
                .from('project_users')
                .whereIn('project_id', function() {
                  this.select('project_id')
                    .from('project_users')
                    .where('user_id', req.user.id);
                });
            });
      });
    } else {
      usersQuery = usersQuery.andWhere('id', req.user.id);
    }
    const usersCount = await usersQuery.count('* as count').first().then(r => parseInt(r.count || 0));

    res.json({
      projects: projectsCount,
      records: recordsCount,
      complete: completeCount,
      sites: sitesCount,
      users: usersCount
    });
  } catch (error) {
    next(error);
  }
};

export const deleteProject = async (req, res, next) => {
  const { pid } = req.params;

  const trx = await db.transaction();
  try {
    const existing = await trx('projects').where({ id: pid }).first();
    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: 'Project not found' });
    }

    await trx('projects').where({ id: pid }).update({ deleted: true });

    // Log global audit entry for project deletion
    await trx('audit_log').insert({
      project_id: null,
      record_id: null,
      instrument_id: null,
      user_id: req.user.id,
      user_name: req.user.name,
      action: 'PROJECT_DELETED',
      field_name: 'project_id',
      old_value: existing.title,
      new_value: `id:${pid}`,
      ip_address: req.ip,
    });

    await trx.commit();
    logger.info(`Project deleted: "${existing.title}" (ID: ${pid}) by Admin ${req.user.email}`);
    res.json({ success: true, message: 'Project and all associated trial data deleted successfully' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

function shuffle(array) {
  const arr = [...array];
  let currentIndex = arr.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [arr[currentIndex], arr[randomIndex]] = [arr[randomIndex], arr[currentIndex]];
  }
  return arr;
}

export const getRandSchemes = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const schemes = await db('rand_schemes')
      .where({ project_id: pid })
      .orderBy('created_at', 'desc');
    res.json(schemes);
  } catch (error) {
    next(error);
  }
};

export const createRandScheme = async (req, res, next) => {
  const { pid } = req.params;
  const { name, description, algorithm, block_size, stratify_by, arms, ratio } = req.body;

  if (!name || !arms || !arms.length) {
    return res.status(400).json({ error: 'Name and treatment arms are required' });
  }

  const trx = await db.transaction();
  try {
    const [scheme] = await trx('rand_schemes')
      .insert({
        project_id: pid,
        name,
        description: description || null,
        algorithm: algorithm || 'block',
        block_size: parseInt(block_size) || 4,
        stratify_by: JSON.stringify(stratify_by || []),
        arms: JSON.stringify(arms),
        ratio: JSON.stringify(ratio || []),
        created_by: req.user.id
      })
      .returning('*');

    await logFieldChange(trx, {
      projectId: pid,
      userId: req.user.id,
      userName: req.user.name,
      action: 'RANDOMISATION_SCHEME_CREATED',
      newValue: name,
      ip: req.ip
    });

    await trx.commit();
    logger.info(`Randomisation scheme created: "${name}" for project ${pid} by ${req.user.email}`);
    res.status(201).json(scheme);
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const toggleSeal = async (req, res, next) => {
  const { pid, id } = req.params;
  const { seal } = req.body;
  try {
    await db('rand_schemes')
      .where({ id, project_id: pid })
      .update({ sealed: !!seal });

    await logFieldChange(db, {
      projectId: pid,
      userId: req.user.id,
      userName: req.user.name,
      action: seal ? 'RAND_SEALED' : 'RAND_UNSEALED',
      ip: req.ip
    });

    res.json({ success: true, message: seal ? 'Scheme sealed successfully' : 'Scheme unsealed successfully' });
  } catch (error) {
    next(error);
  }
};

export const getRandStats = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const schemes = await db('rand_schemes').where({ project_id: pid });
    const stats = [];
    for (const s of schemes) {
      const allocations = await db('rand_allocations')
        .where({ scheme_id: s.id })
        .select('arm')
        .count('id as count')
        .groupBy('arm');

      const by_arm = allocations.map(a => ({
        arm: a.arm,
        n: parseInt(a.count) || 0
      }));

      const total = by_arm.reduce((acc, curr) => acc + curr.n, 0);

      const armsParsed = typeof s.arms === 'string' ? JSON.parse(s.arms) : s.arms;

      stats.push({
        scheme_id: s.id,
        scheme_name: s.name,
        arms: armsParsed,
        total,
        by_arm,
        sealed: !!s.sealed
      });
    }
    res.json(stats);
  } catch (error) {
    next(error);
  }
};

export const getRandAllocations = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const allocations = await db('rand_allocations as ra')
      .leftJoin('sites as s', 'ra.site_id', 's.id')
      .leftJoin('users as u', 'ra.allocated_by', 'u.id')
      .where('ra.project_id', pid)
      .select('ra.*', 's.name as site_name', 's.code as site_code', 'u.name as allocator')
      .orderBy('ra.allocated_at', 'desc');

    const sanitized = allocations.map(a => {
      const copy = { ...a };
      if (req.user.role !== 'admin' && !a.unblinded_at) {
        copy.arm = 'Concealed (Randomised)';
      }
      return copy;
    });

    res.json(sanitized);
  } catch (error) {
    next(error);
  }
};

export const allocateParticipant = async (req, res, next) => {
  const { pid } = req.params;
  const { scheme_id, record_id, site_id, strata_data } = req.body;

  if (!scheme_id || !record_id) {
    return res.status(400).json({ error: 'scheme_id and record_id are required' });
  }

  const trx = await db.transaction();
  try {
    const scheme = await trx('rand_schemes').where({ id: scheme_id, project_id: pid }).first();
    if (!scheme) {
      await trx.rollback();
      return res.status(404).json({ error: 'Randomisation scheme not found' });
    }

    if (scheme.sealed) {
      await trx.rollback();
      return res.status(400).json({ error: 'This randomisation scheme is sealed. No new allocations are permitted.' });
    }

    const existing = await trx('rand_allocations').where({ scheme_id, record_id }).first();
    if (existing) {
      await trx.rollback();
      return res.status(400).json({ error: `Participant ${record_id} is already randomised.` });
    }

    let strata_key = '';
    const stratifyVars = typeof scheme.stratify_by === 'string' ? JSON.parse(scheme.stratify_by) : scheme.stratify_by;
    
    if (stratifyVars && stratifyVars.includes('site')) {
      if (!site_id) {
        await trx.rollback();
        return res.status(400).json({ error: 'Site selection is required for stratified randomisation.' });
      }
      const site = await trx('sites').where({ id: site_id }).first();
      if (!site) {
        await trx.rollback();
        return res.status(400).json({ error: 'Selected site not found.' });
      }
      strata_key = `site:${site.code}`;
    }

    if (strata_data) {
      Object.keys(strata_data).sort().forEach(k => {
        strata_key += strata_key ? `|${k}:${strata_data[k]}` : `${k}:${strata_data[k]}`;
      });
    }

    let allocatedArm = null;
    let blockNumber = null;
    let positionInBlock = null;

    if (scheme.algorithm === 'simple') {
      const armsList = typeof scheme.arms === 'string' ? JSON.parse(scheme.arms) : scheme.arms;
      const ratiosList = typeof scheme.ratio === 'string' ? JSON.parse(scheme.ratio) : scheme.ratio;
      
      const pool = [];
      armsList.forEach((arm, idx) => {
        const weight = ratiosList[idx] || 1;
        for (let i = 0; i < weight; i++) {
          pool.push(arm);
        }
      });

      const randomIndex = Math.floor(Math.random() * pool.length);
      allocatedArm = pool[randomIndex];
    } else {
      let block = await trx('rand_blocks')
        .where({ scheme_id: scheme.id, strata_key, used: false })
        .orderBy('block_number', 'asc')
        .first()
        .forUpdate();

      let position = 0;
      if (block) {
        const usedCount = await trx('rand_allocations')
          .where({ scheme_id: scheme.id, strata_key, block_number: block.block_number })
          .count('id as count')
          .first();
        position = parseInt(usedCount.count);

        const seq = typeof block.sequence === 'string' ? JSON.parse(block.sequence) : block.sequence;
        if (position >= seq.length) {
          await trx('rand_blocks').where({ id: block.id }).update({ used: true });
          block = null;
        }
      }

      if (!block) {
        const lastBlock = await trx('rand_blocks')
          .where({ scheme_id: scheme.id, strata_key })
          .orderBy('block_number', 'desc')
          .first();
        const nextBlockNumber = lastBlock ? lastBlock.block_number + 1 : 1;

        const armsList = typeof scheme.arms === 'string' ? JSON.parse(scheme.arms) : scheme.arms;
        const ratiosList = typeof scheme.ratio === 'string' ? JSON.parse(scheme.ratio) : scheme.ratio;
        const ratioSum = ratiosList.reduce((a, b) => a + b, 0);

        const items = [];
        const copies = scheme.block_size / ratioSum;
        
        armsList.forEach((arm, idx) => {
          const count = copies * (ratiosList[idx] || 1);
          for (let i = 0; i < count; i++) {
            items.push(arm);
          }
        });

        const shuffledSequence = shuffle(items);

        [block] = await trx('rand_blocks')
          .insert({
            scheme_id: scheme.id,
            strata_key,
            block_number: nextBlockNumber,
            sequence: JSON.stringify(shuffledSequence),
            used: false
          })
          .returning('*');
        position = 0;
      }

      const finalSequence = typeof block.sequence === 'string' ? JSON.parse(block.sequence) : block.sequence;
      allocatedArm = finalSequence[position];
      blockNumber = block.block_number;
      positionInBlock = position + 1;

      if (position + 1 >= finalSequence.length) {
        await trx('rand_blocks').where({ id: block.id }).update({ used: true });
      }
    }

    await trx('rand_allocations')
      .insert({
        scheme_id: scheme.id,
        project_id: pid,
        record_id,
        site_id,
        arm: allocatedArm,
        strata_key: strata_key || null,
        block_number: blockNumber,
        position_in_block: positionInBlock,
        allocated_by: req.user.id
      });

    await trx('audit_log').insert({
      project_id: pid,
      record_id,
      user_id: req.user.id,
      user_name: req.user.name,
      action: 'RANDOMISED',
      new_value: `Record ${record_id} randomised stratified by: ${strata_key || 'none'}`,
      ip_address: req.ip
    });

    await trx.commit();
    logger.info(`Participant ${record_id} randomised to: ${allocatedArm} under scheme ${scheme.id}`);
    res.json({ success: true, arm: allocatedArm });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const unblindParticipant = async (req, res, next) => {
  const { pid, id } = req.params;
  try {
    const allocation = await db('rand_allocations')
      .where({ id, project_id: pid })
      .first();

    if (!allocation) {
      return res.status(404).json({ error: 'Allocation entry not found' });
    }

    await db('rand_allocations')
      .where({ id })
      .update({
        unblinded_at: db.fn.now(),
        unblinded_by: req.user.id
      });

    await db('audit_log').insert({
      project_id: pid,
      record_id: allocation.record_id,
      user_id: req.user.id,
      user_name: req.user.name,
      action: 'UNBLINDED',
      new_value: `Unblinded record: ${allocation.record_id}`,
      ip_address: req.ip
    });

    res.json({ success: true, arm: allocation.arm });
  } catch (error) {
    next(error);
  }
};

export const uploadAttachment = async (req, res, next) => {
  const { pid } = req.params;
  const { record_id, field_id, instrument_id } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // 1. Check if instrument_id is provided
    if (instrument_id) {
      const inst = await db('instruments').where({ id: instrument_id, project_id: pid }).first();
      if (inst) {
        // Parse fields
        const fields = typeof inst.fields === 'string' ? JSON.parse(inst.fields) : inst.fields;
        const field = fields.find(f => f.id === field_id || f.label.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'') === field_id);
        
        if (field && field.accept && field.accept !== '*') {
          const allowedExtensions = field.accept.split(',').map(e => e.trim().toLowerCase());
          const fileExtension = path.extname(file.originalname).toLowerCase();
          
          if (!allowedExtensions.includes(fileExtension)) {
            // Delete the uploaded file from disk to avoid clutter
            fs.unlinkSync(file.path);
            return res.status(400).json({ error: `Invalid MIME file format. Allowed formats: ${field.accept}` });
          }
        }
      }
    }

    // 2. Save attachment entry in database
    const [attachment] = await db('attachments')
      .insert({
        project_id: pid,
        record_id: record_id || 'temp',
        instrument_id: instrument_id ? parseInt(instrument_id) : null,
        field_id: field_id || null,
        filename: file.filename,
        original_name: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        uploaded_by: req.user.id
      })
      .returning('*');

    // 3. Trigger audit log
    await db('audit_log').insert({
      project_id: pid,
      record_id: record_id || 'temp',
      user_id: req.user.id,
      user_name: req.user.name,
      action: 'FILE_UPLOADED',
      new_value: `Uploaded file: ${file.originalname} (size: ${file.size} bytes)`,
      ip_address: req.ip
    });

    // 4. Return attachment detail
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const fileUrl = `${protocol}://${host}/uploads/${file.filename}`;

    res.json({
      success: true,
      id: attachment.id,
      filename: file.filename,
      original_name: file.originalname,
      url: fileUrl
    });
  } catch (error) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    next(error);
  }
};

export const getDDEData = async (req, res, next) => {
  const { pid } = req.params;
  try {
    let query = db('dde_records as d')
      .leftJoin('instruments as i', 'd.instrument_id', 'i.id')
      .leftJoin('users as u', 'd.entered_by', 'u.id')
      .where('d.project_id', pid);

    if (req.user.role === 'data_entry' || req.user.role === 'student') {
      query = query.where('d.entered_by', req.user.id);
    }

    const ddes = await query.select([
      'd.*',
      'i.name as instrument_name',
      'u.name as entered_by_name'
    ]);

    const parsedDdes = ddes.map(d => {
      let discrepancies = d.discrepancies;
      if (typeof discrepancies === 'string') {
        try { discrepancies = JSON.parse(discrepancies); } catch(e) {}
      }
      return {
        ...d,
        discrepancies
      };
    });

    res.json(parsedDdes);
  } catch (error) {
    next(error);
  }
};

export const submitDDERecord = async (req, res, next) => {
  const { pid } = req.params;
  const { primary_record_id, instrument_id, record_id, data } = req.body;
  const userId = req.user.id;

  try {
    const primary = await db('records').where({ id: primary_record_id }).first();
    if (!primary) {
      return res.status(404).json({ error: 'Primary record not found.' });
    }

    if (process.env.NODE_ENV === 'production' && primary.entered_by === userId) {
      return res.status(403).json({ error: 'Double Data Entry protocol violation: The secondary entry must be completed by a different operator than the primary entry.' });
    }

    const instrument = await db('instruments').where({ id: instrument_id }).first();
    if (!instrument) {
      return res.status(404).json({ error: 'Instrument not found.' });
    }

    const fields = typeof instrument.fields === 'string' 
      ? JSON.parse(instrument.fields) 
      : instrument.fields || [];

    const primaryData = typeof primary.data === 'string' 
      ? JSON.parse(primary.data) 
      : primary.data || {};

    const submittedData = data || {};

    const discrepancies = [];
    fields.forEach(f => {
      if (f.type === 'calc' || f.type === 'file') return;
      const val1 = primaryData[f.id] !== undefined ? String(primaryData[f.id]).trim() : '';
      const val2 = submittedData[f.id] !== undefined ? String(submittedData[f.id]).trim() : '';
      if (val1 !== val2) {
        discrepancies.push({
          field_id: f.id,
          field_label: f.label,
          primary_value: primaryData[f.id] !== undefined ? String(primaryData[f.id]) : '',
          dde_value: submittedData[f.id] !== undefined ? String(submittedData[f.id]) : '',
          message: 'Values do not match'
        });
      }
    });

    const isMatch = discrepancies.length === 0;
    const status = isMatch ? 'matched' : 'discrepancy';

    const [ddeRecord] = await db('dde_records')
      .insert({
        project_id: pid,
        instrument_id,
        record_id,
        primary_record_id,
        status,
        entered_by: userId,
        data: typeof submittedData === 'string' ? submittedData : JSON.stringify(submittedData),
        discrepancies: JSON.stringify(discrepancies),
        resolved: isMatch,
        created_at: new Date()
      })
      .returning('*');

    if (isMatch) {
      await db('records')
        .where({ id: primary_record_id })
        .update({
          status: 'complete',
          updated_at: new Date()
        });
    }

    res.status(201).json({
      success: true,
      dde_record: ddeRecord,
      discrepancies
    });
  } catch (error) {
    next(error);
  }
};

export const resolveDDEConflict = async (req, res, next) => {
  const { pid, id } = req.params;
  const { resolved_data, resolution_note } = req.body;
  const userId = req.user.id;

  try {
    const ddeRecord = await db('dde_records').where({ id, project_id: pid }).first();
    if (!ddeRecord) {
      return res.status(404).json({ error: 'DDE record not found.' });
    }

    await db('dde_records')
      .where({ id })
      .update({
        resolved: true,
        status: 'resolved',
        resolved_by: userId,
        resolved_at: new Date()
      });

    if (resolved_data && ddeRecord.primary_record_id) {
      await db('records')
        .where({ id: ddeRecord.primary_record_id })
        .update({
          data: typeof resolved_data === 'string' ? resolved_data : JSON.stringify(resolved_data),
          status: 'complete',
          updated_at: new Date()
        });

      await db('audit_log').insert({
        project_id: pid,
        record_id: ddeRecord.record_id,
        user_id: userId,
        user_name: req.user.name,
        action: 'DDE_RESOLVE',
        new_value: `DDE conflict resolved for record ${ddeRecord.record_id}. Note: ${resolution_note || 'None'}`,
        ip_address: req.ip
      });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const getAlertRules = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const rules = await db('alert_rules').where({ project_id: pid }).orderBy('id', 'desc');
    const enriched = await Promise.all(rules.map(async r => {
      const logs = await db('alert_log').where({ rule_id: r.id }).count('id as count').first();
      return {
        ...r,
        fire_count: parseInt(logs.count || 0)
      };
    }));
    res.json(enriched);
  } catch (error) {
    next(error);
  }
};

export const createAlertRule = async (req, res, next) => {
  const { pid } = req.params;
  const { name, instrument_id, trigger_field, trigger_operator, trigger_value, recipients, subject, message } = req.body;

  if (!name || !trigger_field) {
    return res.status(400).json({ error: 'Rule name and trigger field are required' });
  }

  try {
    const [rule] = await db('alert_rules')
      .insert({
        project_id: pid,
        name,
        instrument_id: instrument_id ? parseInt(instrument_id) : null,
        trigger_field,
        trigger_operator: trigger_operator || '=',
        trigger_value: trigger_value || '',
        recipients: typeof recipients === 'string' ? recipients : JSON.stringify(recipients || []),
        subject: subject || null,
        message: message || null,
        active: true
      })
      .returning('*');

    res.status(201).json(rule);
  } catch (error) {
    next(error);
  }
};

export const toggleAlertRule = async (req, res, next) => {
  const { pid, id } = req.params;
  const { active } = req.body;

  try {
    const [updated] = await db('alert_rules')
      .where({ id, project_id: pid })
      .update({ active: !!active })
      .returning('*');
    res.json(updated);
  } catch (error) {
    next(error);
  }
};

export const deleteAlertRule = async (req, res, next) => {
  const { pid, id } = req.params;

  try {
    await db('alert_rules').where({ id, project_id: pid }).del();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const getAlertLog = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const logs = await db('alert_log as l')
      .leftJoin('alert_rules as r', 'l.rule_id', 'r.id')
      .where('l.project_id', pid)
      .select('l.*', 'r.name as rule_name')
      .orderBy('l.sent_at', 'desc');
    res.json(logs);
  } catch (error) {
    next(error);
  }
};

export const testAlertRule = async (req, res, next) => {
  const { pid, id } = req.params;

  try {
    const rule = await db('alert_rules').where({ id, project_id: pid }).first();
    if (!rule) {
      return res.status(404).json({ error: 'Alert rule not found.' });
    }

    const recipients = typeof rule.recipients === 'string' ? JSON.parse(rule.recipients) : rule.recipients || [];
    
    await db('alert_log').insert({
      rule_id: rule.id,
      project_id: pid,
      record_id: 'TEST-RECORD',
      triggered_value: rule.trigger_value || 'TEST_TRIGGER',
      recipients: JSON.stringify(recipients),
      sent_at: new Date(),
      success: true
    });

    res.json({ success: true, message: `Test notification sent successfully to ${recipients.join(', ')}` });
  } catch (error) {
    next(error);
  }
};

// --- SURVEY LINKS MANAGEMENT ---
export const getSurveys = async (req, res, next) => {
  const { pid } = req.params;
  try {
    // Auto-pull new survey responses from central support in standalone/university modes
    if (env.deploymentMode === 'standalone' || env.deploymentMode === 'university') {
      try {
        const { pullSurveyResponsesFromCentral } = await import('../services/syncManager.js');
        await pullSurveyResponsesFromCentral();
      } catch (pullErr) {
        logger.error(`❌ [SURVEY PULL ERROR] Failed to pull responses on list load: ${pullErr.message}`);
      }
    }

    const surveys = await db('survey_links as s')
      .leftJoin('instruments as i', 's.instrument_id', 'i.id')
      .select('s.*', 'i.name as instrument_name')
      .where('s.project_id', pid)
      .orderBy('s.created_at', 'desc');

    const mapped = surveys.map(s => ({
      ...s,
      central_support_url: env.centralSupportUrl,
      deployment_mode: env.deploymentMode
    }));

    res.json(mapped);
  } catch (error) {
    next(error);
  }
};

export const createSurvey = async (req, res, next) => {
  const { pid } = req.params;
  const { instrument_id, label, expires_at } = req.body;

  if (!instrument_id) {
    return res.status(400).json({ error: 'Instrument selection is required' });
  }

  try {
    const token = crypto.randomBytes(16).toString('hex');
    const [survey] = await db('survey_links')
      .insert({
        project_id: pid,
        instrument_id: parseInt(instrument_id),
        token,
        label: label || 'Patient Survey',
        expires_at: expires_at || null,
        active: true,
        responses: 0,
        created_by: req.user.id,
        sync_pending: true
      })
      .returning('*');

    // Attempt to sync immediately in background (don't block response)
    import('../services/syncManager.js').then(({ syncEntityToCentral }) => {
      syncEntityToCentral('survey', survey.id).catch(err => {
        logger.warn(`Deferred survey sync failed: ${err.message}`);
      });
    }).catch(err => {
      logger.warn(`Failed to import syncManager for survey creation: ${err.message}`);
    });

    res.status(201).json(survey);
  } catch (error) {
    next(error);
  }
};

export const closeSurvey = async (req, res, next) => {
  const { pid, id } = req.params;
  try {
    await db('survey_links')
      .where({ id, project_id: pid })
      .update({ active: false, sync_pending: true });

    // Attempt to sync immediately in background
    import('../services/syncManager.js').then(({ syncEntityToCentral }) => {
      syncEntityToCentral('survey', id).catch(err => {
        logger.warn(`Deferred survey close sync failed: ${err.message}`);
      });
    }).catch(err => {
      logger.warn(`Failed to import syncManager for survey close: ${err.message}`);
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const syncSurveyEndpoint = async (req, res, next) => {
  const { id } = req.params;
  try {
    const { syncEntityToCentral } = await import('../services/syncManager.js');
    const result = await syncEntityToCentral('survey', id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// --- AUDIT TRAIL QUERYING ---
export const getProjectAuditLog = async (req, res, next) => {
  const { pid } = req.params;
  try {
    let queryBuilder = db('audit_log as a')
      .leftJoin('records as r', function() {
        this.on('a.project_id', '=', 'r.project_id')
            .andOn('a.record_id', '=', 'r.record_id');
      })
      .select('a.id', 'a.project_id', 'a.record_id', 'a.instrument_id', 'a.user_id', 'a.user_name', 'a.action', 'a.field_name', 'a.old_value', 'a.new_value', 'a.ip_address', 'a.timestamp')
      .where('a.project_id', pid);

    if (req.user.role !== 'admin' && req.user.site_id) {
      queryBuilder = queryBuilder.where(function() {
        this.where('r.site_id', req.user.site_id).orWhereNull('a.record_id');
      });
    }

    const logs = await queryBuilder.orderBy('a.timestamp', 'desc');
    res.json(logs);
  } catch (error) {
    next(error);
  }
};

export const getGlobalAuditLog = async (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access forbidden. Only administrators can view the global audit log.' });
  }

  try {
    const logs = await db('audit_log').orderBy('timestamp', 'desc');
    res.json(logs);
  } catch (error) {
    next(error);
  }
};

export const createAuditLog = async (req, res, next) => {
  const { action, new_value } = req.body;
  try {
    await db('audit_log').insert({
      user_id: req.user.id,
      user_name: req.user.name,
      action: action || 'CUSTOM_ACTION',
      new_value: new_value || '',
      ip: req.ip,
      timestamp: new Date()
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
export const getDQRules = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const rules = await db('dq_rules').where({ project_id: pid }).orderBy('id', 'desc');
    res.json(rules);
  } catch (error) {
    next(error);
  }
};

export const createDQRule = async (req, res, next) => {
  const { pid } = req.params;
  const { name, rule_type, instrument_id, field_id, operator, value, severity } = req.body;
  try {
    const [rule] = await db('dq_rules').insert({
      project_id: pid,
      name,
      rule_type,
      instrument_id: instrument_id || null,
      field_id: field_id || null,
      operator: operator || null,
      value: value || null,
      severity: severity || 'warning'
    }).returning('*');
    res.status(201).json(rule);
  } catch (error) {
    next(error);
  }
};

export const deleteDQRule = async (req, res, next) => {
  const { pid, id } = req.params;
  try {
    await db('dq_rules').where({ id, project_id: pid }).del();
    res.json({ success: true, message: 'DQ Rule deleted' });
  } catch (error) {
    next(error);
  }
};

export const runDQ = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const rules = await db('dq_rules').where({ project_id: pid });
    
    let recordQuery = db('records').where({ project_id: pid });
    if (req.user.role === 'data_entry' || req.user.role === 'student') {
      recordQuery = recordQuery.where('entered_by', req.user.id);
    }
    const records = await recordQuery;

    const instruments = await db('instruments').where({ project_id: pid });
    
    const instMap = {};
    instruments.forEach(i => instMap[i.id] = i.name);
    
    const issues = [];
    let errorsCount = 0;
    let warningsCount = 0;
    
    const now = new Date();
    
    for (const rule of rules) {
      for (const record of records) {
        // Parse data
        let data = {};
        try {
          data = typeof record.data === 'string' ? JSON.parse(record.data) : (record.data || {});
        } catch (e) {
          data = {};
        }
        
        const rtype = rule.rule_type;
        
        // 1. Missing Required Field
        if (rtype === 'missing_required') {
          if (!rule.instrument_id || Number(record.instrument_id) === Number(rule.instrument_id)) {
            const val = data[rule.field_id];
            if (val === undefined || val === null || String(val).trim() === '') {
              issues.push({
                rule_name: rule.name,
                severity: rule.severity,
                message: `Required field '${rule.field_id}' is missing.`,
                instrument: instMap[record.instrument_id] || 'Unknown Instrument',
                record_id: record.record_id
              });
              if (rule.severity === 'error') errorsCount++;
              else warningsCount++;
            }
          }
        }
        
        // 2. Numeric Range Check
        else if (rtype === 'range_check') {
          if (!rule.instrument_id || Number(record.instrument_id) === Number(rule.instrument_id)) {
            const val = data[rule.field_id];
            if (val !== undefined && val !== null && String(val).trim() !== '') {
              const numVal = Number(val);
              const ruleVal = Number(rule.value);
              if (!isNaN(numVal) && !isNaN(ruleVal)) {
                let isIssue = false;
                switch (rule.operator) {
                  case '>': isIssue = numVal > ruleVal; break;
                  case '<': isIssue = numVal < ruleVal; break;
                  case '>=': isIssue = numVal >= ruleVal; break;
                  case '<=': isIssue = numVal <= ruleVal; break;
                  case '=': isIssue = numVal === ruleVal; break;
                }
                if (isIssue) {
                  issues.push({
                    rule_name: rule.name,
                    severity: rule.severity,
                    message: `Field '${rule.field_id}' value (${val}) is ${rule.operator} ${rule.value} (out of bounds).`,
                    instrument: instMap[record.instrument_id] || 'Unknown Instrument',
                    record_id: record.record_id
                  });
                  if (rule.severity === 'error') errorsCount++;
                  else warningsCount++;
                }
              }
            }
          }
        }
        
        // 3. Stale Incomplete Record
        else if (rtype === 'stale_incomplete') {
          if (record.status === 'incomplete') {
            const recordDate = new Date(record.created_at || record.updated_at);
            const diffTime = Math.abs(now - recordDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const threshold = Number(rule.value) || 7;
            if (diffDays > threshold) {
              issues.push({
                rule_name: rule.name,
                severity: rule.severity,
                message: `Record is incomplete and stale (not completed for ${diffDays} days, threshold ${threshold} days).`,
                instrument: instMap[record.instrument_id] || 'Unknown Instrument',
                record_id: record.record_id
              });
              if (rule.severity === 'error') errorsCount++;
              else warningsCount++;
            }
          }
        }
      }
    }
    
    res.json({
      issues,
      summary: {
        errors: errorsCount,
        warnings: warningsCount,
        total: errorsCount + warningsCount
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── DATA QUERY & DISCREPANCY FLOW ──────────────────────────────────────────
export const getQueries = async (req, res, next) => {
  const { pid } = req.params;
  try {
    // 1. Run DQ checks to auto-sync automated queries
    const rules = await db('dq_rules').where({ project_id: pid });
    
    let recordQuery = db('records').where({ project_id: pid });
    if (req.user.role === 'data_entry' || req.user.role === 'student') {
      recordQuery = recordQuery.where('entered_by', req.user.id);
    }
    const records = await recordQuery;

    const instruments = await db('instruments').where({ project_id: pid });
    
    const instMap = {};
    instruments.forEach(i => instMap[i.id] = i.name);
    
    const now = new Date();
    const activeViolations = [];
    
    for (const rule of rules) {
      for (const record of records) {
        let data = {};
        try {
          data = typeof record.data === 'string' ? JSON.parse(record.data) : (record.data || {});
        } catch (e) {
          data = {};
        }
        
        const rtype = rule.rule_type;
        let isViolation = false;
        let message = '';
        
        if (rtype === 'missing_required') {
          if (!rule.instrument_id || Number(record.instrument_id) === Number(rule.instrument_id)) {
            const val = data[rule.field_id];
            if (val === undefined || val === null || String(val).trim() === '') {
              isViolation = true;
              message = `Required field '${rule.field_id}' is missing.`;
            }
          }
        } else if (rtype === 'range_check') {
          if (!rule.instrument_id || Number(record.instrument_id) === Number(rule.instrument_id)) {
            const val = data[rule.field_id];
            if (val !== undefined && val !== null && String(val).trim() !== '') {
              const numVal = Number(val);
              const ruleVal = Number(rule.value);
              if (!isNaN(numVal) && !isNaN(ruleVal)) {
                let isIssue = false;
                switch (rule.operator) {
                  case '>': isIssue = numVal > ruleVal; break;
                  case '<': isIssue = numVal < ruleVal; break;
                  case '>=': isIssue = numVal >= ruleVal; break;
                  case '<=': isIssue = numVal <= ruleVal; break;
                  case '=': isIssue = numVal === ruleVal; break;
                }
                if (isIssue) {
                  isViolation = true;
                  message = `Field '${rule.field_id}' value (${val}) is ${rule.operator} ${rule.value} (out of bounds).`;
                }
              }
            }
          }
        } else if (rtype === 'stale_incomplete') {
          if (record.status === 'incomplete') {
            const recordDate = new Date(record.created_at || record.updated_at);
            const diffTime = Math.abs(now - recordDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const threshold = Number(rule.value) || 7;
            if (diffDays > threshold) {
              isViolation = true;
              message = `Record is incomplete and stale (not completed for ${diffDays} days, threshold ${threshold} days).`;
            }
          }
        }
        
        if (isViolation) {
          activeViolations.push({
            project_id: Number(pid),
            record_id: record.record_id,
            record_db_id: record.id,
            instrument_id: record.instrument_id,
            field_id: rule.field_id || 'system',
            query_text: message,
            severity: rule.severity || 'warning'
          });
        }
      }
    }
    
    // Sync activeViolations with database
    for (const v of activeViolations) {
      const existing = await db('data_queries')
        .where({
          project_id: v.project_id,
          record_id: v.record_id,
          instrument_id: v.instrument_id,
          field_id: v.field_id,
          status: 'open'
        })
        .first();
        
      if (!existing) {
        await db('data_queries').insert({
          project_id: v.project_id,
          record_id: v.record_id,
          record_db_id: v.record_db_id,
          instrument_id: v.instrument_id,
          field_id: v.field_id,
          query_text: v.query_text,
          severity: v.severity,
          status: 'open'
        });
      }
    }
    
    // Automatically close resolved queries (if violation no longer exists)
    const openQueries = await db('data_queries').where({ project_id: pid, status: 'open' });
    for (const q of openQueries) {
      const isStillViolated = activeViolations.some(v => 
        String(v.record_id) === String(q.record_id) && 
        Number(v.instrument_id) === Number(q.instrument_id) && 
        String(v.field_id) === String(q.field_id)
      );
      
      if (!isStillViolated && q.raised_by === null) {
        await db('data_queries')
          .where({ id: q.id })
          .update({ status: 'resolved', resolution_comment: 'Auto-resolved by data correction', updated_at: db.fn.now() });
      }
    }
    
    // 2. Fetch all queries for response
    let queriesBuilder = db('data_queries as dq')
      .leftJoin('users as u1', 'dq.raised_by', 'u1.id')
      .leftJoin('users as u2', 'dq.resolved_by', 'u2.id')
      .leftJoin('instruments as inst', 'dq.instrument_id', 'inst.id')
      .where({ 'dq.project_id': pid });

    if (req.user.role === 'data_entry' || req.user.role === 'student') {
      queriesBuilder = queriesBuilder.whereIn('dq.record_db_id', function() {
        this.select('id').from('records').where({ entered_by: req.user.id });
      });
    }

    const queries = await queriesBuilder
      .select(
        'dq.*',
        'u1.name as raised_by_name',
        'u2.name as resolved_by_name',
        'inst.name as instrument_name'
      )
      .orderBy('dq.created_at', 'desc');
      
    res.json(queries);
  } catch (error) {
    next(error);
  }
};

export const createQuery = async (req, res, next) => {
  const { pid } = req.params;
  const { record_id, record_db_id, instrument_id, field_id, query_text, severity } = req.body;
  try {
    const [insertedId] = await db('data_queries')
      .insert({
        project_id: pid,
        record_id,
        record_db_id,
        instrument_id,
        field_id,
        query_text,
        severity: severity || 'warning',
        status: 'open',
        raised_by: req.user.id
      });
      
    const query = await db('data_queries').where({ id: insertedId }).first();
    res.status(201).json(query);
  } catch (error) {
    next(error);
  }
};

export const resolveQuery = async (req, res, next) => {
  const { pid, qid } = req.params;
  const { resolution_comment } = req.body;
  try {
    const updatedCount = await db('data_queries')
      .where({ id: qid, project_id: pid })
      .update({
        status: 'resolved',
        resolution_comment: resolution_comment || 'Correction made',
        resolved_by: req.user.id,
        updated_at: db.fn.now()
      });
      
    if (!updatedCount) {
      return res.status(404).json({ error: 'Query not found or not belonging to this project' });
    }
    
    const query = await db('data_queries').where({ id: qid }).first();
    res.json(query);
  } catch (error) {
    next(error);
  }
};


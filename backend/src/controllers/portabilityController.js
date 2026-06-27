import db from '../db/connection.js';
import { encryptPackage, decryptPackage } from '../utils/crypto.js';
import { logger } from '../config/logger.js';
import { logFieldChange } from '../utils/audit.js';

const CURRENT_PLATFORM_VERSION = '16.0';
const CURRENT_SCHEMA_VERSION = 20260602;

/**
 * Exports a project configuration schema as an encrypted .bldeproj package.
 */
export const exportProjectTemplate = async (req, res, next) => {
  const { pid } = req.params;

  try {
    // 1. Fetch root project details
    const project = await db('projects').where({ id: pid, deleted: false }).first();
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // 2. Fetch all configuration tables mapping to project_id
    const instruments = await db('instruments').where({ project_id: pid });
    const events = await db('events').where({ project_id: pid });
    
    // For event_instruments, we join and fetch
    const eventInstruments = await db('event_instruments as ei')
      .join('events as e', 'ei.event_id', 'e.id')
      .join('instruments as i', 'ei.instrument_id', 'i.id')
      .where('e.project_id', pid)
      .select('ei.*', 'e.name as event_name', 'i.name as instrument_name');

    const sites = await db('sites').where({ project_id: pid });
    const randSchemes = await db('rand_schemes').where({ project_id: pid });

    let randBlocks = [];
    if (randSchemes.length > 0) {
      const schemeIds = randSchemes.map(s => s.id);
      randBlocks = await db('rand_blocks').whereIn('scheme_id', schemeIds);
    }

    const dqRules = await db('dq_rules').where({ project_id: pid });
    const alertRules = await db('alert_rules').where({ project_id: pid });

    // 3. Assemble and anonymize metadata
    const anonymizedProject = {
      title: project.title,
      description: project.description,
      longitudinal: !!project.longitudinal,
      randomisation_enabled: !!project.randomisation_enabled,
      multi_site: !!project.multi_site
    };

    const anonymizedSites = sites.map(s => ({
      name: s.name,
      code: s.code,
      city: s.city,
      pi_name: '', // Remove investigator PII
      pi_email: '', // Remove investigator PII
      active: !!s.active
    }));

    const anonymizedInstruments = instruments.map(i => ({
      old_id: i.id,
      name: i.name,
      description: i.description,
      fields: typeof i.fields === 'string' ? JSON.parse(i.fields) : i.fields || [],
      repeating: !!i.repeating
    }));

    const anonymizedEvents = events.map(e => ({
      old_id: e.id,
      name: e.name,
      day_offset: e.day_offset,
      window_before: e.window_before,
      window_after: e.window_after,
      description: e.description,
      sort_order: e.sort_order
    }));

    const anonymizedRandSchemes = randSchemes.map(s => ({
      old_id: s.id,
      name: s.name,
      description: s.description,
      algorithm: s.algorithm,
      block_size: s.block_size,
      stratify_by: typeof s.stratify_by === 'string' ? JSON.parse(s.stratify_by) : s.stratify_by || [],
      arms: typeof s.arms === 'string' ? JSON.parse(s.arms) : s.arms || [],
      ratio: typeof s.ratio === 'string' ? JSON.parse(s.ratio) : s.ratio || [],
      sealed: !!s.sealed
    }));

    const anonymizedRandBlocks = randBlocks.map(b => ({
      scheme_id: b.scheme_id,
      strata_key: b.strata_key,
      block_number: b.block_number,
      sequence: typeof b.sequence === 'string' ? JSON.parse(b.sequence) : b.sequence || [],
      used: false // Reset used status on export template
    }));

    const anonymizedDqRules = dqRules.map(r => ({
      name: r.name,
      description: r.description,
      rule_type: r.rule_type,
      old_instrument_id: r.instrument_id,
      field_id: r.field_id,
      operator: r.operator,
      value: r.value,
      severity: r.severity,
      active: !!r.active
    }));

    const anonymizedAlertRules = alertRules.map(r => ({
      name: r.name,
      old_instrument_id: r.instrument_id,
      trigger_field: r.trigger_field,
      trigger_operator: r.trigger_operator,
      trigger_value: r.trigger_value,
      alert_type: r.alert_type,
      recipients: '[]', // Clear recipient email list PII
      subject: r.subject,
      message: r.message,
      active: !!r.active
    }));

    const packagePayload = {
      metadata: {
        package_type: 'project_setup',
        schema_version: CURRENT_SCHEMA_VERSION,
        platform_version: CURRENT_PLATFORM_VERSION,
        created_date: new Date().toISOString(),
        created_by: {
          user_id: req.user.id,
          name: 'BLDE Certified System Consultant' // Anonymized signature
        }
      },
      project: anonymizedProject,
      sites: anonymizedSites,
      instruments: anonymizedInstruments,
      events: anonymizedEvents,
      event_instruments: eventInstruments.map(ei => ({
        event_name: ei.event_name,
        instrument_name: ei.instrument_name,
        required: !!ei.required
      })),
      rand_schemes: anonymizedRandSchemes,
      rand_blocks: anonymizedRandBlocks,
      dq_rules: anonymizedDqRules,
      alert_rules: anonymizedAlertRules
    };

    // 4. Encrypt using AES-256-GCM + HMAC-SHA256
    const base64Encrypted = encryptPackage(packagePayload);

    // Record audit log event
    await logFieldChange(db, {
      projectId: pid,
      recordId: 'SYSTEM',
      action: 'DATA_EXPORTED',
      newValue: `Project config exported by ${req.user.name}`,
      ip: req.ip,
      userId: req.user.id,
      userName: req.user.name
    });

    res.setHeader('Content-Disposition', `attachment; filename=project_${pid}_template.bldeproj`);
    res.setHeader('Content-Type', 'text/plain');
    res.send(base64Encrypted);
  } catch (error) {
    logger.error('Export error: ', error);
    next(error);
  }
};

/**
 * Imports a project configuration schema from an encrypted .bldeproj package.
 */
export const importProjectTemplate = async (req, res, next) => {
  const { packageData } = req.body;

  if (!packageData) {
    return res.status(400).json({ error: 'Package payload is required' });
  }

  let pkg;
  try {
    pkg = decryptPackage(packageData);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid or corrupted configuration package: ' + error.message });
  }

  // 1. Version Compatibility Validation
  const { metadata, project, sites, instruments, events, event_instruments, rand_schemes, rand_blocks, dq_rules, alert_rules } = pkg;
  if (!metadata || metadata.package_type !== 'project_setup') {
    return res.status(400).json({ error: 'Invalid package type' });
  }

  if (metadata.schema_version > CURRENT_SCHEMA_VERSION) {
    return res.status(400).json({
      error: `Upgrade Required: This package requires database schema version ${metadata.schema_version} or higher. Current platform version is ${CURRENT_SCHEMA_VERSION}. Please update before importing.`
    });
  }

  const trx = await db.transaction();

  try {
    // 2. Name Conflict Resolution
    let targetTitle = project.title;
    const existing = await trx('projects').where({ title: targetTitle, deleted: false }).first();
    if (existing) {
      const dateStr = new Date().toISOString().slice(0, 10);
      targetTitle = `${targetTitle} (Imported ${dateStr})`;
    }

    // 3. Insert Project Root
    const [newProject] = await trx('projects')
      .insert({
        organization_id: req.user.organization_id || 1,
        title: targetTitle,
        description: project.description,
        status: 'development', // Force imported projects to development mode
        longitudinal: !!project.longitudinal,
        randomisation_enabled: !!project.randomisation_enabled,
        multi_site: !!project.multi_site,
        created_by: req.user.id
      })
      .returning('*');

    const newPid = newProject.id;

    // 4. Remapping Lookup Tables
    const instrumentIdMap = {};
    const eventIdMap = {};
    const siteIdMap = {};
    const schemeIdMap = {};

    // 5. Insert Instruments
    for (const inst of (instruments || [])) {
      const [newInst] = await trx('instruments')
        .insert({
          project_id: newPid,
          name: inst.name,
          description: inst.description,
          fields: typeof inst.fields === 'string' ? inst.fields : JSON.stringify(inst.fields || []),
          repeating: !!inst.repeating,
          status: 'draft' // Import as draft to allow initial adjustments
        })
        .returning('*');
      instrumentIdMap[inst.old_id] = newInst.id;
    }

    // 6. Insert Events (if longitudinal)
    for (const ev of (events || [])) {
      const [newEvent] = await trx('events')
        .insert({
          project_id: newPid,
          name: ev.name,
          day_offset: ev.day_offset || 0,
          window_before: ev.window_before || 0,
          window_after: ev.window_after || 0,
          description: ev.description,
          sort_order: ev.sort_order || 0
        })
        .returning('*');
      eventIdMap[ev.old_id] = newEvent.id;
    }

    // 7. Insert Event-Instrument Join Mapping
    for (const map of (event_instruments || [])) {
      // Find new IDs by matching names
      const matchedEvent = await trx('events').where({ project_id: newPid, name: map.event_name }).first();
      const matchedInst = await trx('instruments').where({ project_id: newPid, name: map.instrument_name }).first();

      if (matchedEvent && matchedInst) {
        await trx('event_instruments').insert({
          event_id: matchedEvent.id,
          instrument_id: matchedInst.id,
          required: !!map.required
        });
      }
    }

    // 8. Insert Sites
    for (const s of (sites || [])) {
      const [newSite] = await trx('sites')
        .insert({
          project_id: newPid,
          name: s.name,
          code: s.code,
          city: s.city,
          pi_name: '',
          pi_email: '',
          active: !!s.active
        })
        .returning('*');
      siteIdMap[s.code] = newSite.id; // Map by site code for easier lookups
    }

    // 9. Insert Randomization Schemes & Blocks
    for (const s of (rand_schemes || [])) {
      const [newScheme] = await trx('rand_schemes')
        .insert({
          project_id: newPid,
          name: s.name,
          description: s.description,
          algorithm: s.algorithm,
          block_size: s.block_size,
          stratify_by: typeof s.stratify_by === 'string' ? s.stratify_by : JSON.stringify(s.stratify_by || []),
          arms: typeof s.arms === 'string' ? s.arms : JSON.stringify(s.arms || []),
          ratio: typeof s.ratio === 'string' ? s.ratio : JSON.stringify(s.ratio || []),
          sealed: !!s.sealed,
          created_by: req.user.id
        })
        .returning('*');
      schemeIdMap[s.old_id] = newScheme.id;

      // Filter and insert blocks belonging to this old scheme ID
      const associatedBlocks = (rand_blocks || []).filter(b => b.scheme_id === s.old_id);
      for (const b of associatedBlocks) {
        await trx('rand_blocks').insert({
          scheme_id: newScheme.id,
          strata_key: b.strata_key,
          block_number: b.block_number,
          sequence: typeof b.sequence === 'string' ? b.sequence : JSON.stringify(b.sequence || []),
          used: false
        });
      }
    }

    // 10. Insert Data Quality Rules
    for (const r of (dq_rules || [])) {
      const newInstId = instrumentIdMap[r.old_instrument_id] || null;
      await trx('dq_rules').insert({
        project_id: newPid,
        name: r.name,
        description: r.description,
        rule_type: r.rule_type,
        instrument_id: newInstId,
        field_id: r.field_id,
        operator: r.operator,
        value: r.value,
        severity: r.severity,
        active: !!r.active
      });
    }

    // 11. Insert Alert Rules
    for (const r of (alert_rules || [])) {
      const newInstId = instrumentIdMap[r.old_instrument_id] || null;
      await trx('alert_rules').insert({
        project_id: newPid,
        name: r.name,
        instrument_id: newInstId,
        trigger_field: r.trigger_field,
        trigger_operator: r.trigger_operator,
        trigger_value: r.trigger_value,
        alert_type: r.alert_type,
        recipients: '[]',
        subject: r.subject,
        message: r.message,
        active: !!r.active,
        created_by: req.user.id
      });
    }

    // 12. Create Project-User Mapping for the importing user
    await trx('project_users').insert({
      project_id: newPid,
      user_id: req.user.id,
      can_view: true,
      can_edit: true,
      can_delete: true,
      can_export: true,
      can_manage: true
    });

    // 13. Audit trail registration
    await logFieldChange(trx, {
      projectId: newPid,
      recordId: 'SYSTEM',
      action: 'RECORD_CREATED',
      newValue: `Project schema imported successfully: ${targetTitle}`,
      ip: req.ip,
      userId: req.user.id,
      userName: req.user.name
    });

    await trx.commit();
    logger.info(`Project imported successfully: Title="${targetTitle}" ID=${newPid} by User ID=${req.user.id}`);
    res.status(201).json({ success: true, project_id: newPid, title: targetTitle });
  } catch (error) {
    await trx.rollback();
    logger.error('Import schema failed: ', error);
    next(error);
  }
};

/**
 * Decrypts a project configuration package and returns metadata + key schema metrics.
 */
export const previewProjectTemplate = async (req, res, next) => {
  const { packageData } = req.body;

  if (!packageData) {
    return res.status(400).json({ error: 'Package payload is required' });
  }

  try {
    const pkg = decryptPackage(packageData);
    
    // Safety check of structure
    const { project, instruments, events, dq_rules, alert_rules } = pkg;
    if (!project) {
      return res.status(400).json({ error: 'Invalid configuration package' });
    }

    res.json({
      title: project.title,
      description: project.description || '',
      longitudinal: !!project.longitudinal,
      randomisation_enabled: !!project.randomisation_enabled,
      multi_site: !!project.multi_site,
      instruments: (instruments || []).map(i => {
        let fields = [];
        try {
          fields = typeof i.fields === 'string' ? JSON.parse(i.fields) : (i.fields || []);
        } catch (e) {
          fields = [];
        }
        return {
          name: i.name,
          description: i.description || '',
          fields_count: fields.length
        };
      }),
      events: (events || []).map(e => ({
        name: e.name,
        day_offset: e.day_offset || 0,
        description: e.description || ''
      })),
      dq_rules_count: (dq_rules || []).length,
      alert_rules_count: (alert_rules || []).length
    });
  } catch (error) {
    logger.error('Preview schema failed: ', error);
    res.status(400).json({ error: 'Invalid or corrupted configuration package: ' + error.message });
  }
};

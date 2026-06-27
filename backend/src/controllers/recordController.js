import db from '../db/connection.js';
import { logger } from '../config/logger.js';
import { logFieldChange } from '../utils/audit.js';

export const recalculateCalculatedFields = async (trx, projectId, instrumentId, dataPayload) => {
  const inst = await trx('instruments').where({ id: instrumentId }).first();
  if (!inst) return dataPayload;

  const fields = typeof inst.fields === 'string' ? JSON.parse(inst.fields) : inst.fields || [];
  const calcFields = fields.filter(f => f.type === 'calc');
  if (calcFields.length === 0) return dataPayload;

  const resolvedData = { ...dataPayload };

  calcFields.forEach(cf => {
    if (!cf.formula) return;
    const scope = {};
    fields.forEach(ff => {
      if (ff.type !== 'calc') {
        const v = parseFloat(resolvedData[ff.id]);
        scope[ff.id] = isNaN(v) ? 0 : v;
      }
    });

    try {
      let formula = cf.formula;
      Object.entries(scope).forEach(([k, v]) => {
        formula = formula.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
      });

      if (/[^0-9\.\+\-\*\/\(\)\s]/.test(formula)) return;

      let val = Function('"use strict";return (' + formula + ')')();
      if (!isFinite(val)) {
        val = null;
      } else if (cf.decimalPlaces !== undefined) {
        val = parseFloat(val.toFixed(cf.decimalPlaces));
      }
      
      resolvedData[cf.id] = val !== null ? val : '';
    } catch (e) {
      resolvedData[cf.id] = '';
    }
  });

  return resolvedData;
};

export const triggerAlertRules = async (trx, projectId, recordId, instrumentId, newData) => {
  try {
    const rules = await trx('alert_rules').where({ project_id: projectId, active: true });
    for (const r of rules) {
      if (r.instrument_id && r.instrument_id !== instrumentId) continue;

      const triggerField = r.trigger_field;
      const submittedVal = newData[triggerField];
      if (submittedVal === undefined) continue;

      const valStr = String(submittedVal).trim();
      const ruleValStr = String(r.trigger_value || '').trim();

      let isTriggered = false;
      if (r.trigger_operator === '=') {
        isTriggered = valStr === ruleValStr;
      } else if (r.trigger_operator === '!=') {
        isTriggered = valStr !== ruleValStr;
      } else if (r.trigger_operator === '>') {
        isTriggered = parseFloat(valStr) > parseFloat(ruleValStr);
      } else if (r.trigger_operator === '<') {
        isTriggered = parseFloat(valStr) < parseFloat(ruleValStr);
      } else if (r.trigger_operator === 'contains') {
        isTriggered = valStr.includes(ruleValStr);
      }

      if (isTriggered) {
        await trx('alert_log').insert({
          rule_id: r.id,
          project_id: projectId,
          record_id: recordId,
          triggered_value: valStr,
          recipients: typeof r.recipients === 'string' ? r.recipients : JSON.stringify(r.recipients || []),
          sent_at: new Date(),
          success: true
        });
      }
    }
  } catch (e) {
    logger.error('Error triggering alert rules:', e);
  }
};

// --- READ ALL RECORDS (WITH SITE FILTER FOR DAGs) ---
export const getRecords = async (req, res, next) => {
  const { pid } = req.params;

  try {
    let queryBuilder = db('records as r')
      .leftJoin('instruments as i', 'r.instrument_id', 'i.id')
      .leftJoin('users as u', 'r.entered_by', 'u.id')
      .leftJoin('users as lu', 'r.locked_by', 'lu.id')
      .leftJoin('sites as s', 'r.site_id', 's.id')
      .leftJoin('events as e', 'r.event_id', 'e.id')
      .select(
        'r.*',
        'i.name as instrument_name',
        'i.repeating',
        'u.name as entered_by_name',
        'lu.name as locked_by_name',
        's.name as site_name',
        's.code as site_code',
        'e.name as event_name'
      )
      .where('r.project_id', pid);

    // Site DAG Enforcement: Non-admins can only see records for their mapped site
    if (req.user.role !== 'admin' && req.user.site_id) {
      queryBuilder = queryBuilder.where(function() {
        this.where('r.site_id', req.user.site_id).orWhereNull('r.site_id');
      });
    }

    // Role-based visibility enforcement for Data Entry Operator:
    // Can only view records entered by themselves.
    if (req.user.role === 'data_entry' || req.user.role === 'student') {
      queryBuilder = queryBuilder.where('r.entered_by', req.user.id);
    }

    const records = await queryBuilder.orderBy('r.record_id', 'asc').orderBy('r.repeat_instance', 'asc');
    
    // Parse dynamic JSON payloads safely
    const parsed = records.map(r => ({
      ...r,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data
    }));

    res.json(parsed);
  } catch (error) {
    next(error);
  }
};

// --- SUBJECT ENROLLMENT ---
const calculateNextRecordIdInternal = async (trx, projectId) => {
  const records = await trx('records')
    .where('project_id', projectId)
    .select('record_id')
    .distinct();

  if (records.length === 0) {
    return 'P-001';
  }

  const parsed = records.map(r => {
    const match = r.record_id.match(/^([A-Za-z0-9_-]*?)(\d+)$/);
    if (match) {
      return {
        prefix: match[1],
        num: parseInt(match[2], 10),
        digits: match[2].length
      };
    }
    return null;
  }).filter(Boolean);

  if (parsed.length === 0) {
    return 'P-001';
  }

  const prefixCounts = {};
  parsed.forEach(p => {
    prefixCounts[p.prefix] = (prefixCounts[p.prefix] || 0) + 1;
  });

  let dominantPrefix = 'P-';
  let maxCount = -1;
  Object.entries(prefixCounts).forEach(([prefix, count]) => {
    if (count > maxCount) {
      maxCount = count;
      dominantPrefix = prefix;
    }
  });

  const samePrefix = parsed.filter(p => p.prefix === dominantPrefix);
  const maxNum = Math.max(...samePrefix.map(p => p.num));
  const nextNum = maxNum + 1;

  const maxDigits = Math.max(...samePrefix.map(p => p.digits));
  const nextNumStr = String(nextNum).padStart(maxDigits, '0');

  return `${dominantPrefix}${nextNumStr}`;
};

// --- SUBJECT ENROLLMENT ---
export const enrollSubject = async (req, res, next) => {
  const { pid } = req.params;
  const { instrument_id, record_id, data, status, site_id, repeat_instance, event_id, auto_generated } = req.body;

  if (!instrument_id || (!record_id && !auto_generated)) {
    return res.status(400).json({ error: 'instrument_id and record_id are required' });
  }

  const trx = await db.transaction();
  try {
    // 0. Lock project row to serialize concurrent enrollments
    await trx('projects').where({ id: pid }).forUpdate();

    let finalRecordId = record_id;
    if (auto_generated) {
      finalRecordId = await calculateNextRecordIdInternal(trx, pid);
    }

    // Verify that this specific instrument entry for the participant does not already exist
    const existing = await trx('records')
      .where({
        project_id: pid,
        record_id: finalRecordId,
        instrument_id,
        event_id: event_id || null,
        repeat_instance: repeat_instance || 1
      })
      .first();
      
    if (existing) {
      await trx.rollback();
      return res.status(400).json({ error: `An entry for participant "${finalRecordId}" under this instrument/event already exists.` });
    }

    // 1. Site check for researchers
    const effectiveSite = req.user.role === 'admin' ? (site_id || null) : (req.user.site_id || null);

    // 2. Parse payload safely and recalculate calc fields on backend
    let parsedData = data ? (typeof data === 'string' ? JSON.parse(data) : data) : {};
    parsedData = await recalculateCalculatedFields(trx, pid, instrument_id, parsedData);
    const dataPayload = JSON.stringify(parsedData);

    const [record] = await trx('records')
      .insert({
        project_id: pid,
        instrument_id,
        record_id: finalRecordId,
        event_id: event_id || null,
        site_id: effectiveSite,
        repeat_instance: repeat_instance || 1,
        data: dataPayload,
        status: status || 'incomplete',
        entered_by: req.user.id
      })
      .returning('*');

    await logFieldChange(trx, {
      projectId: pid,
      recordId: finalRecordId,
      instrumentId: instrument_id,
      userId: req.user.id,
      userName: req.user.name,
      action: 'SUBJECT_ENROLLED',
      newValue: `site:${effectiveSite || 'none'}`,
      ip: req.ip
    });

    await triggerAlertRules(trx, pid, finalRecordId, instrument_id, parsedData);
    await trx.commit();
    logger.info(`Subject enrolled: "${finalRecordId}" in project ${pid} by ${req.user.email}`);
    res.status(201).json({
      ...record,
      data: JSON.parse(dataPayload)
    });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

// --- SAVE CLINICAL DATA ---
export const saveClinicalData = async (req, res, next) => {
  const { id } = req.params;
  const { data, status } = req.body;

  const trx = await db.transaction();
  try {
    const existing = await trx('records').where({ id }).first();
    if (!existing) {
      await trx.rollback();
      return res.status(404).json({ error: 'Record not found' });
    }

    // 1. Seal boundaries check: Locked records cannot be edited
    if (existing.locked) {
      await trx.rollback();
      return res.status(403).json({ error: 'This record has been verified and locked. Modifications are disabled.' });
    }

    // 2. Site isolation bounds check (DAG)
    if (req.user.role !== 'admin' && req.user.site_id && existing.site_id && existing.site_id !== req.user.site_id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access forbidden. You can only enter data for patients at your site.' });
    }

    // 2.5 Data Entry Operator check: Can only edit records entered by themselves
    if ((req.user.role === 'data_entry' || req.user.role === 'student') && existing.entered_by !== req.user.id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access forbidden. Data entry operators can only modify records entered by themselves.' });
    }

    const oldData = typeof existing.data === 'string' ? JSON.parse(existing.data) : existing.data || {};
    let newData = data || {};

    // 2.5 Concurrency sync conflict checks
    if (req.body.version_id !== undefined && existing.version_id > parseInt(req.body.version_id)) {
      await trx.rollback();
      return res.status(409).json({ error: 'This record has been modified by another user. Please reload the page to resolve the conflict.' });
    }

    newData = await recalculateCalculatedFields(trx, existing.project_id, existing.instrument_id, newData);

    // 3. Save new values and increment version_id
    await trx('records')
      .where({ id })
      .update({
        data: JSON.stringify(newData),
        status: status || existing.status,
        version_id: (existing.version_id || 1) + 1,
        updated_at: new Date()
      });

    // 4. Compare fields and log audit trail entries
    for (const [key, val] of Object.entries(newData)) {
      const oldVal = oldData[key];
      if (String(oldVal || '') !== String(val || '')) {
        await logFieldChange(trx, {
          projectId: existing.project_id,
          recordId: existing.record_id,
          instrumentId: existing.instrument_id,
          userId: req.user.id,
          userName: req.user.name,
          action: 'FIELD_CHANGED',
          fieldName: key,
          oldValue: oldVal,
          newValue: val,
          ip: req.ip
        });
      }
    }

    await triggerAlertRules(trx, existing.project_id, existing.record_id, existing.instrument_id, newData);
    await trx.commit();
    res.json({ success: true, message: 'Clinical data saved successfully' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

// --- RECORD SIGN & LOCK ---
export const lockRecord = async (req, res, next) => {
  const { id } = req.params;
  const { signature, lock } = req.body;

  const performLock = lock !== undefined ? !!lock : true;

  const trx = await db.transaction();
  try {
    const rec = await trx('records').where({ id }).first();
    if (!rec) {
      await trx.rollback();
      return res.status(404).json({ error: 'Record not found' });
    }

    // Verify DAG authority
    if (req.user.role !== 'admin' && req.user.site_id && rec.site_id && rec.site_id !== req.user.site_id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access forbidden. Site mismatch.' });
    }

    // Data Entry Operator restriction: Can only sign/lock records entered by themselves
    if ((req.user.role === 'data_entry' || req.user.role === 'student') && rec.entered_by !== req.user.id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access forbidden. Data entry operators can only sign/lock records entered by themselves.' });
    }

    await trx('records')
      .where({ id })
      .update({
        locked: performLock,
        locked_by: performLock ? req.user.id : null,
        locked_at: performLock ? new Date() : null,
        lock_signature: performLock ? (signature || 'ELECTRONIC SIGNATURE') : null
      });

    await logFieldChange(trx, {
      projectId: rec.project_id,
      recordId: rec.record_id,
      instrumentId: rec.instrument_id,
      userId: req.user.id,
      userName: req.user.name,
      action: performLock ? 'RECORD_LOCKED' : 'RECORD_UNLOCKED',
      newValue: performLock ? signature || 'E-Signature sealed' : 'Unsealed',
      ip: req.ip
    });

    await trx.commit();
    logger.info(`Record ${rec.record_id} locked status updated to ${performLock} by ${req.user.email}`);
    res.json({ success: true, message: `Record successfully ${performLock ? 'locked' : 'unlocked'}` });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const deleteRecord = async (req, res, next) => {
  const { id } = req.params;

  const trx = await db.transaction();
  try {
    const rec = await trx('records').where({ id }).first();
    if (!rec) {
      await trx.rollback();
      return res.status(404).json({ error: 'Record not found' });
    }

    if (rec.locked) {
      await trx.rollback();
      return res.status(403).json({ error: 'This record is locked and cannot be deleted.' });
    }

    // Enforce DAG site boundaries for non-admin researchers
    if (req.user.role !== 'admin' && req.user.site_id && rec.site_id && rec.site_id !== req.user.site_id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access forbidden. Site mismatch.' });
    }

    // Data Entry Operator restriction: Can only delete records entered by themselves
    if ((req.user.role === 'data_entry' || req.user.role === 'student') && rec.entered_by !== req.user.id) {
      await trx.rollback();
      return res.status(403).json({ error: 'Access forbidden. Data entry operators can only delete records entered by themselves.' });
    }

    await trx('records').where({ id }).del();

    await logFieldChange(trx, {
      projectId: rec.project_id,
      recordId: rec.record_id,
      instrumentId: rec.instrument_id,
      userId: req.user.id,
      userName: req.user.name,
      action: 'RECORD_DELETED',
      newValue: rec.record_id,
      ip: req.ip
    });

    await trx.commit();
    logger.info(`Record ${rec.record_id} (ID: ${id}) deleted by ${req.user.email}`);
    res.json({ success: true, message: 'Record deleted successfully' });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

export const getNextRecordId = async (req, res, next) => {
  const { pid } = req.params;
  try {
    const nextId = await calculateNextRecordIdInternal(db, pid);
    res.json({ nextId });
  } catch (error) {
    next(error);
  }
};


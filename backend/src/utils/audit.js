import { logger } from '../config/logger.js';

/**
 * Inserts a highly detailed audit log entry within an active Knex transaction.
 * Establishes compliance logs matching clinical standards.
 */
export const logFieldChange = async (trx, {
  projectId,
  recordId,
  instrumentId,
  userId,
  userName,
  action,
  fieldName = null,
  oldValue = null,
  newValue = null,
  ip = null
}) => {
  try {
    await trx('audit_log').insert({
      project_id: projectId || null,
      record_id: recordId || null,
      instrument_id: instrumentId || null,
      user_id: userId || null,
      user_name: userName || 'System',
      action,
      field_name: fieldName,
      old_value: oldValue !== undefined && oldValue !== null ? String(oldValue) : null,
      new_value: newValue !== undefined && newValue !== null ? String(newValue) : null,
      ip_address: ip,
    });
  } catch (err) {
    logger.error(`Failed to record database audit trail entry: ${err.message}`, {
      projectId,
      recordId,
      action
    });
    throw err; // Escapes to parent transaction to force query rollback
  }
};

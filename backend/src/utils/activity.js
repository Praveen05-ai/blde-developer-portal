import db from '../db/connection.js';

/**
 * Creates an activity log entry in the activity_logs table.
 * Supports running within an active Knex transaction.
 */
export const logActivity = async (trx, {
  organizationId,
  userId,
  entityType,
  entityId,
  action,
  metadata = null
}) => {
  const conn = trx || db;
  await conn('activity_logs').insert({
    organization_id: organizationId || null,
    user_id: userId || null,
    entity_type: entityType,
    entity_id: entityId,
    action,
    metadata_json: metadata ? JSON.stringify(metadata) : null,
    created_at: new Date()
  });
};

/**
 * dispatches an alert notification to a specific user.
 * Supports running within an active Knex transaction.
 */
export const createNotification = async (trx, {
  userId,
  title,
  message,
  relatedType = null,
  relatedId = null
}) => {
  const conn = trx || db;
  await conn('notifications').insert({
    user_id: userId,
    title,
    message,
    read: false,
    related_type: relatedType,
    related_id: relatedId,
    created_at: new Date()
  });
};

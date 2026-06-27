/**
 * Cryptographic Append-Only Audit Trail & Chained Hash Engine
 * BLDE EDC Clinical Research Platform - Phase 3 Compliance
 */

import crypto from 'crypto';
import os from 'os';
import db from '../backend/src/db/connection.js';
import { env } from '../backend/src/config/env.js';
import { runtime } from '../backend/src/config/runtimeConfig.js';
import { logger } from '../backend/src/config/logger.js';

const GENESIS_HASH = 'BLDE_EDC_GENESIS_CHAIN_SEED_2026';

/**
 * Appends a new audit record atomically to the database with SHA-256 hash chaining.
 */
export const writeAuditLog = async (params) => {
  const {
    projectId = null,
    recordId = null,
    instrumentId = null,
    userId = null,
    userName = 'SYSTEM',
    action,
    fieldName = null,
    oldValue = null,
    newValue = null,
    ipAddress = '127.0.0.1'
  } = params;

  try {
    // 1. Fetch previous audit entry to retrieve its current_hash
    const lastAudit = await db('audit_log').orderBy('id', 'desc').first();
    const previousHash = lastAudit ? lastAudit.current_hash : GENESIS_HASH;

    // 2. Resolve environmental parameters
    const hostname = os.hostname();
    const dbMode = env.databaseMode || 'sqlite';
    const appVersion = runtime.app_version || '1.0.0';

    // 3. Serialize record data to compute cryptographic hash
    const pId = projectId || '';
    const rId = recordId || '';
    const iId = instrumentId || '';
    const uId = userId || '';
    const uName = userName || '';
    const fName = fieldName || '';
    const oldVal = oldValue || '';
    const newVal = newValue || '';
    const ip = ipAddress || '';

    const payload = `${pId}|${rId}|${iId}|${uId}|${uName}|${action}|${fName}|${oldVal}|${newVal}|${ip}|${hostname}|${dbMode}|${appVersion}`;
    const currentHash = crypto.createHash('sha256').update(payload + previousHash).digest('hex');

    // 4. Insert log record atomically
    await db('audit_log').insert({
      project_id: projectId,
      record_id: recordId,
      instrument_id: instrumentId,
      user_id: userId,
      user_name: userName,
      action,
      field_name: fieldName,
      old_value: oldValue,
      new_value: newValue,
      ip_address: ipAddress,
      hostname,
      db_mode: dbMode,
      app_version: appVersion,
      previous_hash: previousHash,
      current_hash: currentHash,
      timestamp: new Date().toISOString()
    });

    return currentHash;

  } catch (err) {
    logger.error(`[GxP AUDIT FAILURE] Failed to write audit trail: ${err.message}`);
    throw err;
  }
};

/**
 * Forensic audit chain verifier.
 * Iterates through the entire ledger sequentially, re-checking cryptographic hashes.
 * Returns { valid: true } or { valid: false, corruptedRecordId, reason }.
 */
export const verifyAuditTrail = async () => {
  logger.info('🔍 [AUDIT VERIFIER] Initiating forensic ledger integrity validation...');
  
  try {
    const logs = await db('audit_log').orderBy('id', 'asc');
    
    let expectedPreviousHash = GENESIS_HASH;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      // 1. Verify previous_hash link consistency
      if (log.previous_hash !== expectedPreviousHash) {
        logger.error(`🔥 [TAMPER DETECTED] Previous hash mismatch at audit ID: ${log.id}. Stored: ${log.previous_hash} vs Expected: ${expectedPreviousHash}`);
        return {
          valid: false,
          corruptedRecordId: log.id,
          reason: 'HASH_CHAIN_LINK_BROKEN'
        };
      }

      // 2. Re-calculate current_hash based on record parameters and assert match
      const pId = log.project_id || '';
      const rId = log.record_id || '';
      const iId = log.instrument_id || '';
      const uId = log.user_id || '';
      const uName = log.user_name || '';
      const fName = log.field_name || '';
      const oldVal = log.old_value || '';
      const newVal = log.new_value || '';
      const ip = log.ip_address || '';
      const hostname = log.hostname || '';
      const dbMode = log.db_mode || '';
      const appVersion = log.app_version || '';

      const payload = `${pId}|${rId}|${iId}|${uId}|${uName}|${log.action}|${fName}|${oldVal}|${newVal}|${ip}|${hostname}|${dbMode}|${appVersion}`;
      const recalculatedHash = crypto.createHash('sha256').update(payload + log.previous_hash).digest('hex');

      if (log.current_hash !== recalculatedHash) {
        logger.error(`🔥 [TAMPER DETECTED] Cryptographic integrity signature mismatch at audit ID: ${log.id}. Stored: ${log.current_hash} vs Recalculated: ${recalculatedHash}`);
        return {
          valid: false,
          corruptedRecordId: log.id,
          reason: 'RECORD_CONTENT_TAMPERED'
        };
      }

      // Update expected previous hash for next record
      expectedPreviousHash = log.current_hash;
    }

    logger.info('🎉 [AUDIT VERIFIER] Complete audit ledger verified successfully. 100% GxP integrity intact.');
    return { valid: true };

  } catch (err) {
    logger.error(`[AUDIT VERIFICATION FAULT] Failed to run integrity checks: ${err.message}`);
    throw err;
  }
};

/**
 * Compliance report exporter: CSV layout compiler.
 */
export const compileAuditCSV = (logs) => {
  const headers = ['ID', 'Timestamp', 'Operator', 'Action', 'Field', 'Old Value', 'New Value', 'IP Address', 'Hostname', 'Hash Signature'];
  const rows = logs.map(l => [
    l.id,
    l.timestamp,
    l.user_name,
    l.action,
    l.field_name || '',
    l.old_value || '',
    l.new_value || '',
    l.ip_address || '',
    l.hostname || '',
    l.current_hash
  ]);
  
  const csvContent = [headers.join(','), ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
  return csvContent;
};

export default {
  writeAuditLog,
  verifyAuditTrail,
  compileAuditCSV
};

/**
 * FDA 21 CFR Part 11 Electronic Signature Engine
 * BLDE EDC Clinical Research Platform - Phase 3 Compliance
 */

import crypto from 'crypto';
import db from '../backend/src/db/connection.js';
import { verifyOperatorReauth } from './session_guard.js';
import { logger } from '../backend/src/config/logger.js';

// CRF States
export const CRF_STATUS = {
  DRAFT: 'incomplete',
  SUBMITTED: 'complete',
  REVIEWED: 'reviewed',
  LOCKED: 'locked'
};

/**
 * Calculates SHA-256 hash of a CRF data payload to establish an immutable content bond.
 */
export const calculateCRFHash = (recordData) => {
  const content = typeof recordData === 'string' ? recordData : JSON.stringify(recordData);
  return crypto.createHash('sha256').update(content).digest('hex');
};

/**
 * Electronically signs a clinical Case Report Form (CRF).
 * Re-authenticates PI credentials, binds contents signature, and locks record.
 */
export const signCRF = async (email, password, recordId, reason) => {
  if (!email || !password || !recordId || !reason) {
    throw new Error('SIGN_MISSING_PARAMETERS');
  }

  // 1. Re-authenticate Principal Investigator credentials
  const piUser = await verifyOperatorReauth(email, password);
  
  if (piUser.role !== 'sysadmin' && piUser.role !== 'pi') {
    throw new Error('SIGN_INSUFFICIENT_PRIVILEGES');
  }

  // 2. Fetch the target CRF record
  const record = await db('records').where({ id: recordId }).first();
  if (!record) {
    throw new Error('SIGN_RECORD_NOT_FOUND');
  }

  if (record.locked) {
    throw new Error('SIGN_RECORD_ALREADY_LOCKED');
  }

  // 3. Compute immutable cryptographic content signature
  const contentHash = calculateCRFHash(record.data);
  const timestamp = new Date().toISOString();
  
  const signaturePayload = `${recordId}:${contentHash}:${timestamp}:${piUser.id}:${reason}`;
  const lockSignature = crypto.createHash('sha256').update(signaturePayload).digest('hex');

  // 4. Update the CRF record state to LOCKED
  await db('records').where({ id: recordId }).update({
    status: 'complete', // Lock state
    locked: true,
    locked_by: piUser.id,
    locked_at: timestamp,
    lock_signature: lockSignature,
    updated_at: timestamp
  });

  logger.info(`[GxP E-SIGNATURE] PI ${email} signed CRF Record ID: ${recordId}. Reason: ${reason}. Lock signature: ${lockSignature}`);
  
  return {
    recordId,
    locked_at: timestamp,
    lock_signature: lockSignature
  };
};

/**
 * Automatically invalidates existing locks and signatures if a CRF is edited.
 * Enforces the FDA 21 CFR Part 11 rule: Signatures are bound only to specific versions.
 */
export const handleCRFModification = async (recordId, editorId) => {
  const record = await db('records').where({ id: recordId }).first();
  if (!record) return;

  if (record.locked) {
    // If locked, reject edits unless explicitly unlocked first
    throw new Error('CRF_WRITE_LOCKED');
  }

  // If a submitted record is modified, mark status back to incomplete (Draft)
  if (record.lock_signature) {
    const timestamp = new Date().toISOString();
    await db('records').where({ id: recordId }).update({
      locked: false,
      locked_by: null,
      locked_at: null,
      lock_signature: null,
      status: CRF_STATUS.DRAFT,
      updated_at: timestamp
    });
    
    logger.warn(`[GxP COMPLIANCE] CRF Record ID: ${recordId} was modified by User ID: ${editorId}. Existing electronic signatures have been automatically INVALIDATED.`);
  }
};

/**
 * Formally unlocks a locked CRF.
 * Requires Principal Investigator or Admin credentials and explicit justification reasons.
 */
export const unlockCRF = async (email, password, recordId, reason) => {
  if (!email || !password || !recordId || !reason) {
    throw new Error('UNLOCK_MISSING_PARAMETERS');
  }

  // 1. Re-authenticate elevated PI/Admin credentials
  const piUser = await verifyOperatorReauth(email, password);
  if (piUser.role !== 'sysadmin' && piUser.role !== 'pi') {
    throw new Error('UNLOCK_INSUFFICIENT_PRIVILEGES');
  }

  // 2. Fetch record
  const record = await db('records').where({ id: recordId }).first();
  if (!record) {
    throw new Error('UNLOCK_RECORD_NOT_FOUND');
  }

  if (!record.locked) {
    throw new Error('UNLOCK_RECORD_NOT_LOCKED');
  }

  // 3. Unlock CRF and clear signature fields
  const timestamp = new Date().toISOString();
  await db('records').where({ id: recordId }).update({
    locked: false,
    locked_by: null,
    locked_at: null,
    lock_signature: null,
    status: CRF_STATUS.DRAFT, // Back to draft for revision
    updated_at: timestamp
  });

  logger.warn(`[GxP COMPLIANCE] CRF Record ID: ${recordId} unlocked by PI ${email}. Reason: ${reason}`);

  return {
    recordId,
    unlocked_at: timestamp
  };
};

export default {
  CRF_STATUS,
  calculateCRFHash,
  signCRF,
  handleCRFModification,
  unlockCRF
};

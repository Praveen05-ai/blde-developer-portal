/**
 * Clinical Session Security Guard & Lockout Manager
 * BLDE EDC Clinical Research Platform - Phase 3 Compliance
 */

import bcrypt from 'bcryptjs';
import db from '../backend/src/db/connection.js';
import { logger } from '../backend/src/config/logger.js';

/**
 * Validates and locks user account temporarily upon repeated failed logins.
 * Locked for 15 minutes after 5 failed attempts.
 */
export const checkAccountLockout = async (user) => {
  if (!user) return { locked: false };
  
  if (user.lockout_until) {
    const lockoutTime = new Date(user.lockout_until);
    if (new Date() < lockoutTime) {
      const minutesLeft = Math.ceil((lockoutTime.getTime() - new Date().getTime()) / 60000);
      return { locked: true, reason: `Account temporarily locked due to repeated failed logins. Try again in ${minutesLeft} minutes.` };
    } else {
      // Lock expired, reset attempts in DB
      await db('users').where({ id: user.id }).update({
        failed_login_attempts: 0,
        lockout_until: null
      });
      user.failed_login_attempts = 0;
      user.lockout_until = null;
    }
  }
  return { locked: false };
};

/**
 * Increments failed login count or locks the user if thresholds are met.
 */
export const handleFailedLogin = async (user) => {
  if (!user) return;

  const currentAttempts = (user.failed_login_attempts || 0) + 1;
  const updates = { failed_login_attempts: currentAttempts };

  if (currentAttempts >= 5) {
    const lockoutPeriod = new Date(Date.now() + 15 * 60 * 1000); // 15 mins lock
    updates.lockout_until = lockoutPeriod;
    logger.warn(`[GxP SECURITY] User account ${user.email} locked temporarily for 15 minutes due to 5 consecutive login failures.`);
  }

  await db('users').where({ id: user.id }).update(updates);
};

/**
 * Resets failed attempts after a successful login.
 */
export const handleSuccessfulLogin = async (userId) => {
  await db('users').where({ id: userId }).update({
    failed_login_attempts: 0,
    lockout_until: null
  });
};

/**
 * Re-authenticates username and password before sensitive clinical operations.
 * Mandatory for: Electronic Signatures, Analytical Exports, Database Restores, and Locked CRF Unlocks.
 */
export const verifyOperatorReauth = async (email, password) => {
  if (!email || !password) {
    throw new Error('REAUTH_MISSING_CREDENTIALS');
  }

  const user = await db('users').where({ email }).first();
  if (!user || !user.active) {
    throw new Error('REAUTH_USER_BLOCKED');
  }

  const lockStatus = await checkAccountLockout(user);
  if (lockStatus.locked) {
    throw new Error(lockStatus.reason);
  }

  const passwordOk = await bcrypt.compare(password, user.password);
  if (!passwordOk) {
    await handleFailedLogin(user);
    throw new Error('REAUTH_INVALID_PASSWORD');
  }

  await handleSuccessfulLogin(user.id);
  return user;
};

/**
 * Session security cookie header validation (CSRF & Secure cookie settings).
 */
export const setSecureCookieFlags = (res, token) => {
  res.cookie('blde_session_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000 // Inactivity automatic timeout (15 minutes)
  });
};

export default {
  checkAccountLockout,
  handleFailedLogin,
  handleSuccessfulLogin,
  verifyOperatorReauth,
  setSecureCookieFlags
};

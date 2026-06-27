/**
 * Centralized Role-Based Access Control (RBAC) & Password Governance
 * BLDE EDC Clinical Research Platform - Phase 3 Compliance
 */

import { logger } from '../backend/src/config/logger.js'; // Fallback path mapping or dynamic backend import

// 1. Role Definitions
export const ROLES = {
  ADMIN: 'sysadmin',
  PI: 'pi',
  COORDINATOR: 'coordinator',
  OPERATOR: 'operator',
  MONITOR: 'monitor',
  REVIEWER: 'reviewer'
};

// 2. Permission Definitions
export const PERMISSIONS = {
  CRF_VIEW: 'crf_view',
  CRF_CREATE: 'crf_create',
  CRF_EDIT: 'crf_edit',
  CRF_SUBMIT: 'crf_submit',
  CRF_SIGN: 'crf_sign',
  CRF_UNLOCK: 'crf_unlock',
  AUDIT_VIEW: 'audit_view',
  EXPORTS_EXEC: 'exports_exec',
  BACKUP_RESTORE: 'backup_restore',
  USER_MANAGE: 'user_manage'
};

// 3. Centralized Permission Mapping per Role
const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: [
    PERMISSIONS.CRF_VIEW, PERMISSIONS.CRF_CREATE, PERMISSIONS.CRF_EDIT, PERMISSIONS.CRF_SUBMIT,
    PERMISSIONS.CRF_SIGN, PERMISSIONS.CRF_UNLOCK, PERMISSIONS.AUDIT_VIEW, PERMISSIONS.EXPORTS_EXEC,
    PERMISSIONS.BACKUP_RESTORE, PERMISSIONS.USER_MANAGE
  ],
  [ROLES.PI]: [
    PERMISSIONS.CRF_VIEW, PERMISSIONS.CRF_CREATE, PERMISSIONS.CRF_EDIT, PERMISSIONS.CRF_SUBMIT,
    PERMISSIONS.CRF_SIGN, PERMISSIONS.CRF_UNLOCK, PERMISSIONS.AUDIT_VIEW, PERMISSIONS.EXPORTS_EXEC
  ],
  [ROLES.COORDINATOR]: [
    PERMISSIONS.CRF_VIEW, PERMISSIONS.CRF_CREATE, PERMISSIONS.CRF_EDIT, PERMISSIONS.CRF_SUBMIT,
    PERMISSIONS.AUDIT_VIEW
  ],
  [ROLES.OPERATOR]: [
    PERMISSIONS.CRF_VIEW, PERMISSIONS.CRF_CREATE, PERMISSIONS.CRF_EDIT, PERMISSIONS.CRF_SUBMIT
  ],
  [ROLES.MONITOR]: [
    PERMISSIONS.CRF_VIEW, PERMISSIONS.AUDIT_VIEW
  ],
  [ROLES.REVIEWER]: [
    PERMISSIONS.CRF_VIEW
  ]
};

/**
 * Route-level RBAC authorization middleware.
 * Enforces explicit role permissions mapped to the active route action.
 */
export const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required. Access denied.' });
    }

    const userRole = req.user.role;
    const permissions = ROLE_PERMISSIONS[userRole] || [];

    if (!permissions.includes(permission)) {
      logger.warn(`[RBAC UNAUTHORIZED] User ${req.user.email} (Role: ${userRole}) attempted unauthorized action: ${permission} on route: ${req.originalUrl}`);
      return res.status(403).json({ error: 'Access forbidden. Insufficient clinical privileges.' });
    }

    next();
  };
};

/**
 * Password complexity validator (GxP Rule: 8+ chars, upper, lower, number, special).
 */
export const validatePasswordStrength = (password) => {
  if (!password || password.length < 8) return false;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  return hasUpperCase && hasLowerCase && hasNumbers && hasSpecial;
};

/**
 * Password expiration check (90 days).
 */
export const isPasswordExpired = (passwordChangedAt) => {
  if (!passwordChangedAt) return false;
  const changedDate = new Date(passwordChangedAt);
  const expiryDate = new Date(changedDate.getTime() + (90 * 24 * 60 * 60 * 1000));
  return new Date() > expiryDate;
};

export default {
  ROLES,
  PERMISSIONS,
  requirePermission,
  validatePasswordStrength,
  isPasswordExpired
};

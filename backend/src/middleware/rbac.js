import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

// Enforce specific roles (e.g. admin, super_admin, researcher, student, etc.)
export const requireRole = (allowedRoles) => {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = req.user.role ? req.user.role.toLowerCase() : '';
    const normalizedAllowed = roles.map(r => r.toLowerCase());

    if (!normalizedAllowed.includes(userRole) && !normalizedAllowed.includes('admin')) {
      logger.warn(`User ${req.user.email} with role ${req.user.role} denied access to: ${req.originalUrl}`);
      return res.status(403).json({ error: 'Access forbidden. Insufficient permissions.' });
    }

    next();
  };
};

// Enforces tenant/organization level isolation dynamically
export const scopeOrganization = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Standalone mode is running locally, single tenant default
  if (env.deploymentMode === 'standalone') {
    req.organizationId = 1; // Default fallback
    return next();
  }

  // University and SaaS modes require checking organization scope on the user JWT
  if (!req.user.organization_id) {
    logger.warn(`User ${req.user.email} has no mapped organization_id in token.`);
    return res.status(403).json({ error: 'Access forbidden. Mapped organization context required.' });
  }

  req.organizationId = req.user.organization_id;
  next();
};

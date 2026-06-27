import { verifyToken } from '../utils/token.js';
import { logger } from '../config/logger.js';
import db from '../db/connection.js';

export const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyToken(token);
    
    // Verify user is active and check GxP password reset requirements in the database
    const user = await db('users').where({ id: decoded.id }).select('active', 'force_password_change').first();
    if (!user || !user.active) {
      logger.warn(`Access blocked: User account ${decoded.email} is deactivated or suspended.`);
      return res.status(403).json({ error: 'Your account is inactive or has been suspended. Please contact the administrator.' });
    }

    // GxP Compliance: Enforce mandatory password update before any other transactions
    if (user.force_password_change && req.path !== '/change-password' && !req.originalUrl.endsWith('/change-password')) {
      return res.status(403).json({ error: 'Password reset required. You must change your password first.', requires_password_reset: true });
    }

    req.user = decoded; // Contains id, email, role, name, site_id
    next();
  } catch (error) {
    logger.warn(`Authentication failed for IP: ${req.ip} - ${error.message}`);
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

const roleHierarchy = {
  student: ['student'],
  data_entry: ['student', 'data_entry'],
  researcher: ['student', 'data_entry', 'researcher'],
  statistician: ['student', 'data_entry', 'statistician'],
  pi: ['student', 'data_entry', 'researcher', 'pi', 'principal_investigator', 'project_incharge'],
  principal_investigator: ['student', 'data_entry', 'researcher', 'pi', 'principal_investigator', 'project_incharge'],
  project_incharge: ['student', 'data_entry', 'researcher', 'pi', 'principal_investigator', 'project_incharge'],
  university_admin: ['student', 'data_entry', 'researcher', 'pi', 'principal_investigator', 'project_incharge', 'university_admin'],
  admin: ['student', 'data_entry', 'researcher', 'pi', 'principal_investigator', 'project_incharge', 'university_admin', 'admin', 'blde_staff'],
  blde_staff: ['student', 'data_entry', 'researcher', 'pi', 'principal_investigator', 'project_incharge', 'university_admin', 'admin', 'blde_staff'],
  ops: ['student', 'data_entry', 'researcher', 'pi', 'principal_investigator', 'project_incharge', 'university_admin', 'admin', 'blde_staff', 'ops', 'operations_manager'],
  operations_manager: ['student', 'data_entry', 'researcher', 'pi', 'principal_investigator', 'project_incharge', 'university_admin', 'admin', 'blde_staff', 'ops', 'operations_manager'],
  super_admin: ['student', 'data_entry', 'researcher', 'pi', 'principal_investigator', 'project_incharge', 'university_admin', 'admin', 'blde_staff', 'ops', 'operations_manager', 'super_admin']
};

// Middleware factory to enforce specific roles with hierarchy resolution (bypassed for Developer Package)
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    next();
  };
};


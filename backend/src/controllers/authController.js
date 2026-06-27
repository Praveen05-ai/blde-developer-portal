import bcrypt from 'bcryptjs';
import db from '../db/connection.js';
import { signToken, verifyToken } from '../utils/token.js';
import { getTOTPSecret, verifyTOTP } from '../utils/totp.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

// Core audit logger helper
async function logAudit(knex, { projectId, recordId, instrumentId, user, action, fieldName, oldValue, newValue, ip }) {
  try {
    await knex('audit_log').insert({
      project_id: projectId || null,
      record_id: recordId || null,
      instrument_id: instrumentId || null,
      user_id: user?.id || null,
      user_name: user?.name || 'System',
      action,
      field_name: fieldName || null,
      old_value: oldValue != null ? String(oldValue) : null,
      new_value: newValue != null ? String(newValue) : null,
      ip_address: ip || null,
    });
  } catch (err) {
    logger.error(`Audit logging failed: ${err.message}`);
  }
}

export const login = async (req, res, next) => {
  const { email, password, totp_code } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await db('users as u')
      .leftJoin('sites as s', 'u.site_id', 's.id')
      .select('u.*', 's.code as site_code')
      .where('u.email', email)
      .first();

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Your account has not been activated or has been deactivated. Please complete registration activation or contact the administrator.' });
    }

    // 2FA Flow
    if (user.totp_enabled) {
      if (!totp_code) {
        return res.json({ requires_2fa: true });
      }

      const isValid = verifyTOTP(user.totp_secret, totp_code);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid two-factor authentication code' });
      }
    }

    // Sign Token
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      site_id: user.site_id,
      site_code: user.site_code,
      organization_id: user.organization_id,
    });

    await logAudit(db, {
      user,
      action: 'LOGIN',
      ip: req.ip,
    });

    logger.info(`User logged in successfully: ${user.email} (IP: ${req.ip})`);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        site_id: user.site_id,
        site_code: user.site_code,
        organization_id: user.organization_id,
        force_password_change: !!user.force_password_change,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const register = async (req, res, next) => {
  const { name, email, password, role, site_id, organization_id } = req.body;

  try {
    // Manually parse and verify authorization token if not populated by middleware (for optional registration authentication)
    if (!req.user && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const token = req.headers.authorization.split(' ')[1];
      try {
        req.user = verifyToken(token);
      } catch (err) {
        // Ignore parsing errors for bootstrap cases
      }
    }

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const emailLower = email.toLowerCase().trim();

    // 1. Check deployment and registration constraints
    const userCountResult = await db('users').count('id as count').first();
    const userCount = parseInt(userCountResult?.count || '0', 10);

    let finalOrgId = organization_id || 1;
    let finalRole = 'developer';

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain uppercase, lowercase, numbers, and special characters.' });
    }

    const existingUser = await db('users').where({ email: emailLower }).first();
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    // Generate secure 6-digit activation OTP
    const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();

    // Activation is not required for the Developer Package
    const needsActivation = false;

    const [newUser] = await db('users')
      .insert({
        name,
        email: emailLower,
        password: hashedPassword,
        role: finalRole,
        site_id: site_id || null,
        organization_id: finalOrgId || 1,
        active: !needsActivation,
        activation_otp: needsActivation ? generatedOTP : null,
        created_by: req.user ? req.user.id : null
      })
      .returning(['id', 'name', 'email', 'role', 'site_id', 'organization_id', 'active']);

    logger.info(`New user registered successfully: ${emailLower} (ID: ${newUser.id}, Active: ${newUser.active})`);

    if (needsActivation) {
      logger.info(`🔑 [ACTIVATION OTP] Verification OTP for user ${emailLower}: ${generatedOTP}`);
      return res.status(201).json({
        message: 'Account created. Activation OTP generated.',
        requires_activation: true,
        email: emailLower,
        debug_otp: env.nodeEnv === 'development' || env.nodeEnv === 'production' ? generatedOTP : undefined
      });
    }

    res.status(201).json({
      message: 'User registered successfully',
      user: newUser,
    });
  } catch (error) {
    next(error);
  }
};

export const setup2FA = async (req, res, next) => {
  try {
    const secret = getTOTPSecret();
    
    await db('users')
      .where({ id: req.user.id })
      .update({ totp_secret: secret });

    const qrUrl = `otpauth://totp/BLDE-EDC:${req.user.email}?secret=${secret}&issuer=BLDE-EDC`;

    res.json({
      secret,
      otpauth: qrUrl,
    });
  } catch (error) {
    next(error);
  }
};

export const verify2FA = async (req, res, next) => {
  const { code } = req.body;

  try {
    if (!code) {
      return res.status(400).json({ error: '2FA code is required' });
    }

    const user = await db('users').where({ id: req.user.id }).first();
    
    if (!user || !user.totp_secret) {
      return res.status(400).json({ error: '2FA setup not initiated. Please run setup first.' });
    }

    const isValid = verifyTOTP(user.totp_secret, code);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid 2FA code. Verification failed.' });
    }

    await db('users')
      .where({ id: req.user.id })
      .update({ totp_enabled: true });

    logger.info(`Two-factor authentication enabled for user: ${user.email}`);

    res.json({ success: true, message: '2FA enabled successfully' });
  } catch (error) {
    next(error);
  }
};

export const getUsers = async (req, res, next) => {
  try {
    const requesterRole = (req.user.role || '').toLowerCase();
    let query = db('users')
      .select('id', 'name', 'email', 'role', 'site_id', 'totp_enabled', 'active', 'created_at');
    
    if (requesterRole === 'admin') {
      // Admin can see all users in the same organization
      if (req.user.organization_id) {
        query = query.where('organization_id', req.user.organization_id);
      }
    } else if (requesterRole === 'pi' || requesterRole === 'project_incharge') {
      // PI can only see:
      // 1. Self
      // 2. Users created by this PI (created_by = req.user.id)
      // 3. Users assigned to projects where this PI is also assigned
      query = query.andWhere(function() {
        this.where('id', req.user.id)
            .orWhere('created_by', req.user.id)
            .orWhereIn('id', function() {
              this.select('user_id')
                .from('project_users')
                .whereIn('project_id', function() {
                  this.select('project_id')
                    .from('project_users')
                    .where('user_id', req.user.id);
                });
            });
      });
    } else {
      // Non-privileged roles can only see self
      query = query.andWhere('id', req.user.id);
    }

    const users = await query.orderBy('name');
    res.json(users);
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (req, res, next) => {
  const { id } = req.params;
  const { name, email, role, site_id, active, password } = req.body;

  try {
    // Prevent admin from deactivating their own account to prevent lockouts
    if (Number(id) === req.user.id && active === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own admin account.' });
    }

    const targetUser = await db('users').where({ id }).first();
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const requesterRole = (req.user.role || '').toLowerCase();
    if (requesterRole === 'admin') {
      // Admin can manage any user in the same organization
      if (req.user.organization_id && targetUser.organization_id !== req.user.organization_id) {
        return res.status(403).json({ error: 'Access forbidden. Cross-organization boundaries.' });
      }
    } else if (requesterRole === 'pi' || requesterRole === 'project_incharge') {
      // PIs can only manage Data Entry Operators
      if (!['data_entry', 'student'].includes(targetUser.role.toLowerCase()) && Number(id) !== req.user.id) {
        return res.status(403).json({ error: 'Project Incharges are only permitted to manage Data Entry Operator accounts.' });
      }
      if (role && !['data_entry', 'student'].includes(role.toLowerCase())) {
        return res.status(403).json({ error: 'Cannot set user role to non-Data Entry.' });
      }
    } else {
      return res.status(403).json({ error: 'You do not have permission to manage users.' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    
    if (email !== undefined) {
      // Check if email already exists for another user
      const existingUser = await db('users').where({ email }).whereNot({ id }).first();
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered by another user.' });
      }
      updateData.email = email;
    }

    if (role !== undefined) updateData.role = role;
    if (site_id !== undefined) updateData.site_id = site_id || null;
    if (active !== undefined) updateData.active = active;
    
    if (password && password.trim() !== '') {
      updateData.password = bcrypt.hashSync(password, 10);
    }

    await db('users')
      .where({ id })
      .update(updateData);

    logger.info(`User ${id} updated by Admin: ${req.user.email} (Fields: ${Object.keys(updateData).join(', ')})`);
    res.json({ success: true, message: 'User updated successfully' });
  } catch (error) {
    next(error);
  }
};

export const getAllSites = async (req, res, next) => {
  try {
    const sites = await db('sites as s')
      .leftJoin('projects as p', 's.project_id', 'p.id')
      .select('s.id', 's.name', 's.code', 'p.title as project_title')
      .orderBy('s.name', 'asc');
    res.json(sites);
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req, res, next) => {
  const { current_password, new_password } = req.body;

  try {
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    const user = await db('users').where({ id: req.user.id }).first();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 1. Confirm current password matches
    if (!bcrypt.compareSync(current_password, user.password)) {
      return res.status(400).json({ error: 'Invalid current password' });
    }

    // 2. Validate password complexity
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(new_password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain uppercase, lowercase, numbers, and special characters.' });
    }

    // 3. Prevent reuse of the last 5 passwords (GxP compliance requirement)
    let history = [];
    try {
      history = typeof user.password_history === 'string' ? JSON.parse(user.password_history) : user.password_history || [];
    } catch {
      history = [];
    }
    
    // Compare new password against history hashes
    for (const oldHash of history) {
      if (bcrypt.compareSync(new_password, oldHash)) {
        return res.status(400).json({ error: 'Cannot reuse any of your last 5 previous passwords.' });
      }
    }

    // Hash new password
    const hashedPassword = bcrypt.hashSync(new_password, 10);

    // Keep only last 5 in history
    history.push(user.password);
    if (history.length > 5) {
      history.shift();
    }

    // Update user record
    await db('users')
      .where({ id: req.user.id })
      .update({
        password: hashedPassword,
        force_password_change: false,
        password_changed_at: new Date(),
        password_history: JSON.stringify(history),
        failed_login_attempts: 0
      });

    await logAudit(db, {
      user,
      action: 'PASSWORD_CHANGED',
      ip: req.ip
    });

    logger.info(`Password updated for user: ${user.email}`);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
};

export const activateAccount = async (req, res, next) => {
  const { email, otp } = req.body;

  try {
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP code are required.' });
    }

    const user = await db('users').where({ email: email.toLowerCase().trim() }).first();
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.active) {
      return res.status(400).json({ error: 'Account is already active.' });
    }

    if (user.activation_otp !== otp) {
      return res.status(400).json({ error: 'Invalid activation OTP code.' });
    }

    await db('users')
      .where({ id: user.id })
      .update({
        active: true,
        activation_otp: null
      });

    logger.info(`✅ Account activated successfully: ${user.email}`);

    res.json({
      success: true,
      message: 'Account activated successfully! You can now log in.'
    });
  } catch (error) {
    next(error);
  }
};

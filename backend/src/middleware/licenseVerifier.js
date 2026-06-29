import fs from 'fs';
import db from '../db/connection.js';
import { verifySignature, parseUsageLimits } from '../services/licenseService.js';
import { getMachineFingerprint, safeCompare } from '../services/machineFingerprintService.js';
import { performVerification } from '../services/onlineVerificationService.js';
import { verifyToken } from '../utils/token.js';

/**
 * Resolves the active license and decrypts/verifies its payload.
 * Returns { license, payload, error }
 */
export async function getLicenseContext() {
  try {
    const license = await db('licenses').where({ id: 1 }).first();
    if (!license) {
      return { error: 'No license found.' };
    }

    const secret = process.env.JWT_SECRET || 'blde_edc_licensing_gxp_secret_lock_2026';
    const payload = verifySignature(license.license_key, secret);
    return { license, payload };
  } catch (err) {
    // Return the raw license record (if it exists) to allow logging verification failures
    const license = await db('licenses').where({ id: 1 }).first().catch(() => null);
    return { license, error: err.message };
  }
}

/**
 * Helper: Checks if the request is authenticated with an admin or developer role.
 */
function isDeveloperOrAdmin(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = verifyToken(token);
      if (decoded && decoded.role) {
        const role = decoded.role.toLowerCase();
        return (role === 'admin' || role === 'developer');
      }
    } catch (e) {
      // Ignore token decoding error
    }
  }
  return false;
}

/**
 * Global Middleware: Enforces license validity and Read-Only mode on expiration.
 */
export async function verifyLicenseMiddleware(req, res, next) {
  const path = req.path || '';
  // Bypass health check, login, change-password, license-mgmt, license-activation, heartbeat, and billing endpoints
  if (
    path.endsWith('/health') ||
    path.endsWith('/login') ||
    path.includes('/change-password') ||
    path.includes('/license-mgmt') ||
    path.includes('/license-activation') ||
    path.includes('/license-heartbeat') ||
    path.includes('/subscriptions') ||
    path.includes('/invoices') ||
    path.includes('/payments') ||
    path.includes('/billing-reports') ||
    path.includes('/support/sync') ||
    path.includes('/debug-licenses')
  ) {
    return next();
  }

  // Bypass license verification checks for administrators and developers
  if (isDeveloperOrAdmin(req)) {
    return next();
  }

  const context = await getLicenseContext();
  
  if (context.error) {
    if (context.license) {
      await db('license_logs').insert({
        license_id: context.license.id,
        action: 'verification_failure',
        details: `License verification failed: ${context.error}`,
        timestamp: new Date()
      }).catch(() => {});
    }
    return res.status(403).json({ error: 'License verification failed.' });
  }

  const { license, payload } = context;

  // Enforce read-only protection for unpaid, expired, or cancelled subscriptions
  if (license && license.customer_id) {
    const sub = await db('subscriptions')
      .where({ customer_id: license.customer_id })
      .where({ license_id: license.id })
      .orderBy('id', 'desc')
      .first()
      .catch(() => null);

    if (sub) {
      if (sub.status === 'payment_pending') {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'Subscription payment pending. System is in read-only mode.' });
        }
      } else if (sub.status === 'expired') {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'Subscription expired. System is in read-only mode.' });
        }
      } else if (sub.status === 'cancelled') {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'Subscription cancelled. System is in read-only mode.' });
        }
      } else if (sub.status === 'suspended') {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'Subscription suspended. System is in read-only mode.' });
        }
      }
    }
  }

  // Phase 6 Online Verification Checks
  if (license.verification_enabled) {
    // 0.1 Trigger periodic verification check in background if interval elapsed
    if (!license.next_server_check || new Date() > new Date(license.next_server_check)) {
      performVerification().catch(err => console.error('Background heartbeat failed:', err.message));
    }

    // 0.2 Check Emergency Override
    let emergencyActive = false;
    if (license.emergency_override && license.override_until) {
      if (new Date() <= new Date(license.override_until)) {
        emergencyActive = true;
      }
    }

    if (!emergencyActive) {
      const remoteStatus = license.remote_status || 'active';

      // 0.3 Enforce remote status blocks (ReadOnly Mode)
      if (remoteStatus === 'revoked') {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'License revoked by BLDE. Contact support.' });
        }
      } else if (remoteStatus === 'suspended') {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'License suspended by BLDE. Contact support.' });
        }
      } else if (remoteStatus === 'blacklisted') {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'License blacklisted. System is in read-only mode.' });
        }
      } else if (remoteStatus === 'disabled') {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'License disabled. System is in read-only mode.' });
        }
      } else if (remoteStatus === 'machine_mismatch') {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'Machine Mismatch. This license belongs to another computer.' });
        }
      } else if (remoteStatus === 'payment_pending') {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'Payment pending. System is in read-only mode.' });
        }
      } else if (remoteStatus === 'maintenance') {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'System under maintenance. System is in read-only mode.' });
        }
      }

      // 0.4 Enforce offline grace expiration
      if (license.verification_fail_count > license.offline_grace_days) {
        if (req.method !== 'GET') {
          return res.status(403).json({ error: 'Server verification unavailable. Grace period expired. System is in read-only mode.' });
        }
      }
    }
  }

  // 0. Machine Fingerprint Binding Validations
  try {
    const currentFp = getMachineFingerprint();
    const currentHash = currentFp.machine_hash;
    const currentVersion = currentFp.fingerprint_version;

    if (license.machine_binding_status === 'unbound') {
      // First machine binding: Bind license to current machine
      await db('licenses').where({ id: license.id }).update({
        machine_hash: currentHash,
        machine_binding_status: 'bound',
        binding_date: new Date(),
        last_checkin: new Date(),
        fingerprint_version: currentVersion
      });
      await db('license_logs').insert({
        license_id: license.id,
        action: 'machine_bound',
        details: `License bound to machine hash (version: ${currentVersion}).`,
        timestamp: new Date()
      });
      license.machine_hash = currentHash;
      license.machine_binding_status = 'bound';
      license.fingerprint_version = currentVersion;
    } else if (license.machine_binding_status === 'disabled') {
      // Block access immediately
      const lastLog = await db('license_logs').where({ license_id: license.id, action: 'machine_disabled' }).orderBy('id', 'desc').first().catch(() => null);
      if (!lastLog || (new Date() - new Date(lastLog.timestamp) > 60000)) {
        await db('license_logs').insert({
          license_id: license.id,
          action: 'machine_disabled',
          details: `Access blocked: Machine binding is disabled (version: ${license.fingerprint_version || 'v1'}).`,
          timestamp: new Date()
        }).catch(() => {});
      }
      return res.status(403).json({ error: 'Machine Binding Disabled. Contact BLDE Support.' });
    } else if (license.machine_binding_status === 'bound' || license.machine_binding_status === 'mismatch') {
      // Compare hashes if fingerprint version matches
      if (!license.fingerprint_version || license.fingerprint_version === currentVersion) {
        const isMatch = safeCompare(license.machine_hash, currentHash);
        if (!isMatch) {
          if (license.machine_binding_status !== 'mismatch') {
            await db('licenses').where({ id: license.id }).update({
              machine_binding_status: 'mismatch',
              updated_at: new Date()
            }).catch(() => {});
            const obfuscated = license.machine_hash ? license.machine_hash.substring(0, 4) + '****' + license.machine_hash.substring(license.machine_hash.length - 3) : 'none';
            await db('license_logs').insert({
              license_id: license.id,
              action: 'machine_mismatch',
              details: `Machine mismatch detected. Expected obfuscated: ${obfuscated} (version: ${license.fingerprint_version || 'v1'}).`,
              timestamp: new Date()
            }).catch(() => {});
          }
          return res.status(403).json({ error: 'Machine Mismatch. This license belongs to another computer.' });
        } else {
          // Reset mismatch status back to bound if now matching
          const updateData = { last_checkin: new Date() };
          if (license.machine_binding_status === 'mismatch') {
            updateData.machine_binding_status = 'bound';
          }
          await db('licenses').where({ id: license.id }).update(updateData).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('Error during machine validation:', err);
  }

  // 1. Check Suspended Status
  if (license.status === 'suspended') {
    await db('license_logs').insert({
      license_id: license.id,
      action: 'suspended_license_access',
      details: 'Attempted access to suspended license.',
      timestamp: new Date()
    }).catch(() => {});
    return res.status(403).json({ error: 'License is suspended. Please contact the administrator.' });
  }

  // 2. Check Revoked Status
  if (license.status === 'revoked') {
    await db('license_logs').insert({
      license_id: license.id,
      action: 'revoked_license_access',
      details: 'Attempted access to revoked license.',
      timestamp: new Date()
    }).catch(() => {});
    return res.status(403).json({ error: 'License is revoked. Please contact the administrator.' });
  }

  // 3. Check Expiration Date
  const now = new Date();
  const isExpired = license.expiry_date && now > new Date(license.expiry_date);
  
  if (isExpired) {
    await db('license_logs').insert({
      license_id: license.id,
      action: 'expired_license',
      details: `License expired on ${license.expiry_date}. System is running in read-only mode.`,
      timestamp: new Date()
    }).catch(() => {});

    // If expired, reject any modify requests (POST, PUT, DELETE) and allow GET (Read-Only mode)
    if (req.method !== 'GET') {
      return res.status(403).json({ error: 'License expired. System is in read-only mode.' });
    }
  }

  // Log verification success selectively for write actions to avoid log bloat on GET requests
  if (req.method !== 'GET') {
    await db('license_logs').insert({
      license_id: license.id,
      action: 'verification_success',
      details: `Verified license key successfully for ${req.method} ${req.originalUrl || req.url}.`,
      timestamp: new Date()
    }).catch(() => {});
  }

  next();
}


/**
 * Middleware: Enforce Project Creation Limit
 */
export async function checkProjectLimit(req, res, next) {
  if (isDeveloperOrAdmin(req)) {
    return next();
  }
  const context = await getLicenseContext();
  if (context.error) {
    return res.status(403).json({ error: 'License verification failed.' });
  }

  const { license, payload } = context;
  const limits = parseUsageLimits(payload);

  if (limits.max_projects !== null) {
    const projectsCount = await db('projects').where({ deleted: false }).count('id as count').first();
    const currentProjects = parseInt(projectsCount.count || 0, 10);
    
    if (currentProjects >= limits.max_projects) {
      await db('license_logs').insert({
        license_id: license.id,
        action: 'limit_breach',
        details: `Project creation blocked. Current projects: ${currentProjects}, limit: ${limits.max_projects}`,
        timestamp: new Date()
      }).catch(() => {});
      return res.status(403).json({ error: 'Project limit reached. Please upgrade your license.' });
    }
  }

  next();
}

/**
 * Middleware: Enforce User Registration Limit
 */
export async function checkUserLimit(req, res, next) {
  if (isDeveloperOrAdmin(req)) {
    return next();
  }
  const context = await getLicenseContext();
  if (context.error) {
    return res.status(403).json({ error: 'License verification failed.' });
  }

  const { license, payload } = context;
  const limits = parseUsageLimits(payload);

  if (limits.max_users !== null) {
    const usersCount = await db('users').count('id as count').first();
    const currentUsers = parseInt(usersCount.count || 0, 10);

    if (currentUsers >= limits.max_users) {
      await db('license_logs').insert({
        license_id: license.id,
        action: 'limit_breach',
        details: `User registration blocked. Current users: ${currentUsers}, limit: ${limits.max_users}`,
        timestamp: new Date()
      }).catch(() => {});
      return res.status(403).json({ error: 'User limit reached. Please upgrade your license.' });
    }
  }

  next();
}

/**
 * Middleware: Enforce Form (Instrument) Creation Limit
 */
export async function checkFormLimit(req, res, next) {
  if (isDeveloperOrAdmin(req)) {
    return next();
  }
  const context = await getLicenseContext();
  if (context.error) {
    return res.status(403).json({ error: 'License verification failed.' });
  }

  const { license, payload } = context;
  const limits = parseUsageLimits(payload);

  if (limits.max_forms !== null) {
    const formsCount = await db('instruments').count('id as count').first();
    const currentForms = parseInt(formsCount.count || 0, 10);

    if (currentForms >= limits.max_forms) {
      await db('license_logs').insert({
        license_id: license.id,
        action: 'limit_breach',
        details: `Form creation blocked. Current forms: ${currentForms}, limit: ${limits.max_forms}`,
        timestamp: new Date()
      }).catch(() => {});
      return res.status(403).json({ error: 'Form limit reached.' });
    }
  }

  next();
}

/**
 * Middleware: Enforce Record Insertion Limit
 */
export async function checkRecordLimit(req, res, next) {
  if (isDeveloperOrAdmin(req)) {
    return next();
  }
  const context = await getLicenseContext();
  if (context.error) {
    return res.status(403).json({ error: 'License verification failed.' });
  }

  const { license, payload } = context;
  const limits = parseUsageLimits(payload);

  if (limits.max_records !== null) {
    const recordsCount = await db('records').count('id as count').first();
    const currentRecords = parseInt(recordsCount.count || 0, 10);

    if (currentRecords >= limits.max_records) {
      await db('license_logs').insert({
        license_id: license.id,
        action: 'limit_breach',
        details: `Record insertion blocked. Current records: ${currentRecords}, limit: ${limits.max_records}`,
        timestamp: new Date()
      }).catch(() => {});
      return res.status(403).json({ error: 'Record limit reached.' });
    }
  }

  next();
}

/**
 * Middleware: Enforce File Upload and Storage Limits
 */
export async function checkUploadLimits(req, res, next) {
  if (isDeveloperOrAdmin(req)) {
    return next();
  }
  const context = await getLicenseContext();
  if (context.error) {
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    return res.status(403).json({ error: 'License verification failed.' });
  }

  const { license, payload } = context;
  const limits = parseUsageLimits(payload);

  // 1. Check Single File Upload Size Limit
  if (req.file) {
    const fileSizeMB = req.file.size / (1024 * 1024);
    if (limits.max_upload_size_mb !== null && fileSizeMB > limits.max_upload_size_mb) {
      try { fs.unlinkSync(req.file.path); } catch {}
      await db('license_logs').insert({
        license_id: license.id,
        action: 'limit_breach',
        details: `File upload rejected (size: ${fileSizeMB.toFixed(2)} MB, limit: ${limits.max_upload_size_mb} MB).`,
        timestamp: new Date()
      }).catch(() => {});
      return res.status(403).json({ error: 'File size exceeds limit.' });
    }
  }

  // 2. Check Total Cumulative Storage Limit (max_storage_gb)
  if (limits.max_storage_gb !== null) {
    const sumResult = await db('attachments').sum('size as totalSize').first();
    const currentSizeBytes = parseInt(sumResult.totalSize || 0, 10);
    const currentSizeGB = currentSizeBytes / (1024 * 1024 * 1024);

    if (currentSizeGB >= limits.max_storage_gb) {
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      await db('license_logs').insert({
        license_id: license.id,
        action: 'limit_breach',
        details: `Storage upload rejected (used: ${currentSizeGB.toFixed(4)} GB, limit: ${limits.max_storage_gb} GB).`,
        timestamp: new Date()
      }).catch(() => {});
      return res.status(403).json({ error: 'Storage limit exceeded.' });
    }
  }

  next();
}

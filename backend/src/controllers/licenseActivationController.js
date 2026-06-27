import db from '../db/connection.js';
import { verifySignature, parseUsageLimits, parseFeatures } from '../services/licenseService.js';
import { getMachineFingerprint, obfuscateHash, safeCompare } from '../services/machineFingerprintService.js';
import { performVerification } from '../services/onlineVerificationService.js';

const getSecret = () => process.env.JWT_SECRET || 'blde_edc_licensing_gxp_secret_lock_2026';

/**
 * GET /api/license-activation/status
 * Returns active license indicators: type, status, expiration dates, remaining days, machine, and validation data.
 */
export async function getActivationStatus(req, res) {
  try {
    const activeLic = await db('licenses').orderBy('id', 'desc').first();
    if (!activeLic) {
      const currentFp = getMachineFingerprint();
      return res.json({
        status: 'no_license',
        license_type: 'none',
        activation_date: null,
        expiry_date: null,
        days_remaining: 0,
        machine_id: obfuscateHash(currentFp.machine_hash),
        machine_hash_raw: currentFp.machine_hash,
        machine_name: currentFp.machine_name || 'N/A',
        last_validation_date: null,
        organization_name: 'None',
        license_version: 0,
        read_only: true,
        binding_date: null,
        machine_binding_status: 'unbound',
        fingerprint_version: currentFp.fingerprint_version || 'v1',
        allowed_machine_changes: 1,
        machine_change_count: 0,
        changes_remaining: 1
      });
    }

    let payload;
    let tampered = false;

    try {
      payload = verifySignature(activeLic.license_key);
    } catch (err) {
      tampered = true;
    }

    const now = new Date();
    const expiry = activeLic.expiry_date ? new Date(activeLic.expiry_date) : null;
    const isExpired = expiry && now > expiry;
    
    let currentStatus = activeLic.status;
    if (tampered) {
      currentStatus = 'tampered';
    } else if (isExpired) {
      currentStatus = 'expired';
    }

    let daysRemaining = null;
    if (expiry && !isExpired) {
      daysRemaining = Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)));
    } else if (isExpired) {
      daysRemaining = 0;
    }

    const remoteStatus = activeLic.remote_status || 'active';
    const emergencyActive = activeLic.emergency_override && activeLic.override_until && (new Date() <= new Date(activeLic.override_until));

    let isReadOnly = ['expired', 'suspended', 'revoked', 'tampered'].includes(currentStatus);
    
    if (activeLic.verification_enabled && !emergencyActive) {
      if (['revoked', 'suspended', 'blacklisted', 'disabled', 'machine_mismatch', 'payment_pending', 'maintenance'].includes(remoteStatus)) {
        isReadOnly = true;
      }
      if (activeLic.verification_fail_count > activeLic.offline_grace_days) {
        isReadOnly = true;
      }
    }

    // Resolve customer organization
    let orgName = 'Baseline Organization';
    if (activeLic.organization_id) {
      const org = await db('organizations').where({ id: activeLic.organization_id }).first().catch(() => null);
      if (org) {
        orgName = org.name;
      }
    }

    const currentFp = getMachineFingerprint();
    return res.json({
      status: currentStatus,
      license_type: activeLic.license_type,
      activation_date: activeLic.activation_date,
      expiry_date: activeLic.expiry_date,
      days_remaining: daysRemaining,
      machine_id: obfuscateHash(activeLic.machine_hash || activeLic.machine_id || currentFp.machine_hash),
      machine_hash_raw: activeLic.machine_hash || currentFp.machine_hash,
      machine_name: activeLic.machine_name || currentFp.machine_name || 'N/A',
      last_validation_date: activeLic.last_checkin || activeLic.last_validation_date,
      organization_name: orgName,
      license_version: activeLic.license_version || 1,
      read_only: isReadOnly,
      
      // Extended Phase 5 fields
      binding_date: activeLic.binding_date,
      machine_binding_status: activeLic.machine_binding_status || 'unbound',
      fingerprint_version: activeLic.fingerprint_version || currentFp.fingerprint_version || 'v1',
      allowed_machine_changes: activeLic.allowed_machine_changes ?? 1,
      machine_change_count: activeLic.machine_change_count ?? 0,
      changes_remaining: Math.max(0, (activeLic.allowed_machine_changes ?? 1) - (activeLic.machine_change_count ?? 0)),

      // Phase 6 fields
      verification_enabled: !!activeLic.verification_enabled,
      last_server_check: activeLic.last_server_check,
      next_server_check: activeLic.next_server_check,
      offline_grace_days: activeLic.offline_grace_days ?? 30,
      verification_fail_count: activeLic.verification_fail_count ?? 0,
      last_server_response: activeLic.last_server_response,
      verification_server_url: activeLic.verification_server_url,
      backup_verification_server_url: activeLic.backup_verification_server_url,
      remote_status: remoteStatus,
      remote_status_reason: activeLic.remote_status_reason || null,
      emergency_override: !!activeLic.emergency_override,
      override_until: activeLic.override_until
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/license-activation/usage
 * Calculates actual system resource usage vs ceilings specified in the active license.
 */
export async function getActivationUsage(req, res) {
  try {
    const activeLic = await db('licenses').orderBy('id', 'desc').first();
    let limits = {
      max_projects: 0,
      max_users: 0,
      max_forms: 0,
      max_records: 0,
      max_storage_gb: 0,
      max_upload_size_mb: 0,
      max_sessions: 0
    };

    if (activeLic) {
      try {
        const payload = verifySignature(activeLic.license_key);
        limits = parseUsageLimits(payload);
      } catch (err) {
        limits = {
          max_projects: 0,
          max_users: 0,
          max_forms: 0,
          max_records: 0,
          max_storage_gb: 0,
          max_upload_size_mb: 0,
          max_sessions: 0
        };
      }
    }

    // Projects count
    const pCountResult = await db('projects').where({ deleted: false }).count('id as count').first();
    const projectsUsed = parseInt(pCountResult.count || 0, 10);

    // Users count
    const uCountResult = await db('users').count('id as count').first();
    const usersUsed = parseInt(uCountResult.count || 0, 10);

    // Forms count
    const fCountResult = await db('instruments').count('id as count').first();
    const formsUsed = parseInt(fCountResult.count || 0, 10);

    // Records count
    const rCountResult = await db('records').count('id as count').first();
    const recordsUsed = parseInt(rCountResult.count || 0, 10);

    // Storage count (Convert cumulative attachments size to GB)
    const storageResult = await db('attachments').sum('size as totalSize').first();
    const usedSizeBytes = parseInt(storageResult.totalSize || 0, 10);
    const storageUsed = parseFloat((usedSizeBytes / (1024 * 1024 * 1024)).toFixed(3)); // GB

    // Concurrent sessions count (mock count, active sessions count is 1 for current user session)
    const sessionsUsed = 1;

    return res.json({
      projects: { used: projectsUsed, max: limits.max_projects },
      users: { used: usersUsed, max: limits.max_users },
      forms: { used: formsUsed, max: limits.max_forms },
      records: { used: recordsUsed, max: limits.max_records },
      storage: { used: storageUsed, max: limits.max_storage_gb },
      sessions: { used: sessionsUsed, max: limits.max_sessions }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/license-activation/features
 * Returns availability status for all key feature modules.
 */
export async function getActivationFeatures(req, res) {
  try {
    const activeLic = await db('licenses').orderBy('id', 'desc').first();
    let features = {
      survey_module: false,
      api_access: false,
      export_excel: false,
      export_csv: false,
      export_pdf: false,
      file_attachments: false,
      randomization_module: false,
      esignature: false,
      notifications: false,
      mobile_access: false,
      backup_restore: false,
      custom_branding: false
    };

    if (activeLic) {
      try {
        const payload = verifySignature(activeLic.license_key);
        features = parseFeatures(payload);
      } catch (err) {
        // Keep all false if verification fails
      }
    }

    return res.json(features);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/license-activation/history
 * Returns the history grid of previous license activations, renewals, and status states.
 */
export async function getActivationHistory(req, res) {
  try {
    const history = await db('licenses')
      .leftJoin('organizations', 'licenses.organization_id', 'organizations.id')
      .select(
        'licenses.*',
        'organizations.name as customer_name',
        'organizations.name as customer_organization'
      )
      .orderBy('licenses.id', 'desc');

    return res.json(history);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/license-activation/activate
 * Validates, authenticates, and registers a license key.
 */
export async function activateLicense(req, res) {
  const source_ip = req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  let failedSerial = null;
  try {
    const { license_key } = req.body;
    if (!license_key || typeof license_key !== 'string') {
      await db('license_logs').insert({
        license_id: null,
        action: 'invalid_signature',
        details: 'Activation failed: Missing or invalid license key content',
        source_ip,
        failure_reason: 'missing_license_key',
        license_serial: null,
        timestamp: new Date()
      }).catch(() => {});
      return res.status(400).json({ error: 'Invalid file' });
    }

    // Try to parse serial from envelope in case validation fails
    try {
      const parts = license_key.split('.');
      if (parts.length > 0) {
        const payloadStr = Buffer.from(parts[0], 'base64url').toString('utf8');
        const envelope = JSON.parse(payloadStr);
        failedSerial = envelope.data?.license_id_str || envelope.data?.serial || null;
      }
    } catch (e) {}

    let payload;

    // 1. Verify signature
    try {
      payload = verifySignature(license_key);
    } catch (err) {
      let action = 'invalid_signature';
      let reason = 'signature_mismatch';
      if (err.message.includes('version')) {
        action = 'unsupported_version_attempt';
        reason = 'unsupported_version';
      } else if (err.message.includes('fingerprint') || err.message.includes('INTEGRITY')) {
        action = 'invalid_signature';
        reason = 'public_key_integrity_fault';
      }

      await db('license_logs').insert({
        license_id: null,
        action: action,
        details: `Activation failed: ${err.message}`,
        source_ip,
        failure_reason: reason,
        license_serial: failedSerial,
        timestamp: new Date()
      }).catch(() => {});

      if (err.message.includes('TAMPER')) {
        return res.status(400).json({ error: 'Tampered signature' });
      }
      return res.status(400).json({ error: err.message || 'Invalid file' });
    }

    // 2. Validate Expiry
    const now = new Date();
    if (payload.expiry_date) {
      const expiry = new Date(payload.expiry_date);
      if (now > expiry) {
        await db('license_logs').insert({
          license_id: null,
          action: 'expired_license_attempt',
          details: `Activation failed: License expired on ${payload.expiry_date}`,
          source_ip,
          failure_reason: 'license_expired',
          license_serial: payload.license_id_str || failedSerial,
          timestamp: new Date()
        }).catch(() => {});
        return res.status(400).json({ error: 'License expired' });
      }
    }

    // 3. Machine lock check on activation
    const currentFp = getMachineFingerprint();
    const currentHash = currentFp.machine_hash;
    const currentVersion = currentFp.fingerprint_version;

    if (payload.machine_id) {
      const isMatch = safeCompare(payload.machine_id, currentHash);
      if (!isMatch) {
        await db('license_logs').insert({
          license_id: null,
          action: 'machine_mismatch_attempt',
          details: `Activation failed: Machine hardware mismatch. Payload expected: ${payload.machine_id}, System hardware: ${currentHash}`,
          source_ip,
          failure_reason: 'machine_mismatch',
          license_serial: payload.license_id_str || failedSerial,
          timestamp: new Date()
        }).catch(() => {});
        return res.status(400).json({ error: 'Machine mismatch' });
      }
    }

    // 4. Check if license already activated or revoked
    const signature = license_key.split('.')[1];
    const existing = await db('licenses').where({ signature }).first();

    if (existing) {
      if (existing.status === 'revoked') {
        await db('license_logs').insert({
          license_id: existing.id,
          action: 'revoked_license_attempt',
          details: 'Activation failed: License is revoked',
          source_ip,
          failure_reason: 'license_revoked',
          license_serial: existing.license_id_str,
          timestamp: new Date()
        }).catch(() => {});
        return res.status(400).json({ error: 'License revoked' });
      }
      if (existing.machine_binding_status === 'disabled') {
        await db('license_logs').insert({
          license_id: existing.id,
          action: 'machine_mismatch_attempt',
          details: 'Activation failed: Machine binding disabled',
          source_ip,
          failure_reason: 'machine_binding_disabled',
          license_serial: existing.license_id_str,
          timestamp: new Date()
        }).catch(() => {});
        return res.status(400).json({ error: 'Machine Binding Disabled. Contact BLDE Support.' });
      }

      // Check if same machine
      const isSameMachine = existing.machine_hash && safeCompare(existing.machine_hash, currentHash);
      if (isSameMachine) {
        return res.status(400).json({ error: 'License already activated' });
      }

      // Different machine - check machine change policy
      const allowedChanges = existing.allowed_machine_changes ?? 1;
      const currentChanges = existing.machine_change_count ?? 0;

      if (currentChanges >= allowedChanges) {
        // Exceeded limit: Block activation
        await db('license_logs').insert({
          license_id: existing.id,
          action: 'machine_change_limit_exceeded',
          details: `Activation blocked: Machine change limit exceeded. Used: ${currentChanges}, Allowed: ${allowedChanges} (version: ${currentVersion}).`,
          source_ip,
          failure_reason: 'machine_change_limit_exceeded',
          license_serial: existing.license_id_str,
          timestamp: new Date()
        }).catch(() => {});
        return res.status(400).json({ error: 'Machine change limit exceeded. Contact BLDE Support.' });
      } else {
        // Permit one rebound
        const nextChanges = currentChanges + 1;
        await db('licenses').where({ id: existing.id }).update({
          machine_hash: currentHash,
          machine_change_count: nextChanges,
          binding_date: new Date(),
          last_checkin: new Date(),
          machine_binding_status: 'bound',
          fingerprint_version: currentVersion,
          status: 'active',
          updated_at: new Date()
        });

        await db('license_logs').insert({
          license_id: existing.id,
          action: 'machine_rebound',
          details: `License rebound to new machine hash. Changes used: ${nextChanges}/${allowedChanges} (version: ${currentVersion}).`,
          source_ip,
          license_serial: existing.license_id_str,
          timestamp: new Date()
        });

        return res.json({
          success: true,
          message: 'License Reactivated & Rebound Successfully',
          license_id: existing.license_id_str
        });
      }
    }

    if (payload.status === 'revoked') {
      await db('license_logs').insert({
        license_id: null,
        action: 'revoked_license_attempt',
        details: 'Activation failed: License is revoked in payload status',
        source_ip,
        failure_reason: 'license_revoked',
        license_serial: payload.license_id_str || failedSerial,
        timestamp: new Date()
      }).catch(() => {});
      return res.status(400).json({ error: 'License revoked' });
    }

    // 5. Validate Organization Scope
    const prevLic = await db('licenses').orderBy('id', 'desc').first();
    if (payload.organization_id && prevLic && prevLic.organization_id && payload.organization_id !== prevLic.organization_id) {
      await db('license_logs').insert({
        license_id: null,
        action: 'org_mismatch_attempt',
        details: `Activation failed: Organization mismatch. Expected: ${prevLic.organization_id}, Payload: ${payload.organization_id}`,
        source_ip,
        failure_reason: 'organization_mismatch',
        license_serial: payload.license_id_str || failedSerial,
        timestamp: new Date()
      }).catch(() => {});
      return res.status(400).json({ error: 'Organization mismatch' });
    }

    // 6. Validate Machine Binding (Legacy check, redundant but kept for safety)
    if (payload.machine_id && prevLic && prevLic.machine_id && payload.machine_id !== prevLic.machine_id) {
      await db('license_logs').insert({
        license_id: null,
        action: 'machine_mismatch_attempt',
        details: `Activation failed: Legacy machine mismatch with previous license machine_id. Previous: ${prevLic.machine_id}, Payload: ${payload.machine_id}`,
        source_ip,
        failure_reason: 'machine_mismatch',
        license_serial: payload.license_id_str || failedSerial,
        timestamp: new Date()
      }).catch(() => {});
      return res.status(400).json({ error: 'Machine mismatch' });
    }

    // 7. Establish history versioning
    const nextVersion = prevLic ? (prevLic.license_version || 1) + 1 : 1;
    const parentId = prevLic ? prevLic.id : null;

    // Allocate sequential LIC-xxxxxx ID
    const maxLic = await db('licenses').max('id as maxId').first();
    const nextLicId = (maxLic.maxId || 0) + 1;
    const licenseIdStr = `LIC-${String(nextLicId).padStart(6, '0')}`;

    // Insert license
    const [id] = await db('licenses').insert({
      license_key,
      license_type: payload.license_type,
      status: 'active',
      activation_date: payload.activation_date ? new Date(payload.activation_date) : new Date(),
      expiry_date: payload.expiry_date ? new Date(payload.expiry_date) : null,
      machine_id: payload.machine_id || null,
      organization_id: payload.organization_id || null,
      signature,
      license_id_str: licenseIdStr,
      license_version: nextVersion,
      parent_license_id: parentId,
      customer_id: null,
      machine_name: currentFp.machine_name || 'Client Server Node',
      last_validation_date: new Date(),
      notes: `Activated via User Activation Portal. Version ${nextVersion}.`,
      
      // Phase 5 binding
      machine_hash: currentHash,
      machine_binding_status: 'bound',
      binding_date: new Date(),
      last_checkin: new Date(),
      allowed_machine_changes: 1,
      machine_change_count: 0,
      fingerprint_version: currentVersion
    }).returning('id');

    const finalId = (typeof id === 'object' ? (id.id || Object.values(id)[0]) : id) || nextLicId;

    // Set previous active license to 'renewed'
    if (prevLic) {
      await db('licenses').where({ id: prevLic.id }).update({ status: 'renewed' });
    }

    // Parse limits and features
    const parsedLimits = parseUsageLimits(payload);
    const parsedFeatures = parseFeatures(payload);

    await db('license_usage').insert({
      license_id: finalId,
      ...parsedLimits
    });

    await db('license_features').insert({
      license_id: finalId,
      ...parsedFeatures
    });

    // Write activation log
    await db('license_logs').insert({
      license_id: finalId,
      action: 'activation',
      details: `License key ${licenseIdStr} activated successfully via activation portal.`,
      source_ip,
      license_serial: licenseIdStr,
      timestamp: new Date()
    });

    // Write machine bound log
    await db('license_logs').insert({
      license_id: finalId,
      action: 'machine_bound',
      details: `License key ${licenseIdStr} bound to machine hash (version: ${currentVersion}).`,
      source_ip,
      license_serial: licenseIdStr,
      timestamp: new Date()
    });

    return res.json({
      success: true,
      message: 'License Activated Successfully',
      license_id: licenseIdStr
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/license-activation/verify-now
 * Triggers manual verification of the active license against the online server.
 */
export async function triggerManualVerification(req, res) {
  try {
    const result = await performVerification(true);
    if (result.success) {
      return res.json(result);
    } else {
      return res.status(400).json({ error: result.reason });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}


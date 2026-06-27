import db from '../db/connection.js';
import { generateLicenseKey } from '../services/licenseService.js';
import { obfuscateHash } from '../services/machineFingerprintService.js';

// Helper to secure key generation
const getSecret = () => process.env.JWT_SECRET || 'blde_edc_licensing_gxp_secret_lock_2026';

// -----------------------------------------------------------------------------
// CUSTOMER MANAGEMENT CONTROLLERS
// -----------------------------------------------------------------------------

export async function getCustomers(req, res) {
  try {
    const { search } = req.query;
    let query = db('customers').select('*').orderBy('id', 'desc');
    
    if (search) {
      query = query.where((builder) => {
        builder.where('name', 'like', `%${search}%`)
               .orWhere('organization', 'like', `%${search}%`)
               .orWhere('customer_id', 'like', `%${search}%`)
               .orWhere('email', 'like', `%${search}%`);
      });
    }

    const customers = await query;
    return res.json(customers);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createCustomer(req, res) {
  try {
    const { name, organization, contact_person, email, mobile, notes } = req.body;
    if (!name || !organization) {
      return res.status(400).json({ error: 'Name and Organization are required.' });
    }

    // Sequential ID generation
    const maxCust = await db('customers').max('id as maxId').first();
    const nextId = (maxCust.maxId || 0) + 1;
    const customerIdStr = `CUS-${String(nextId).padStart(6, '0')}`;

    const [id] = await db('customers').insert({
      customer_id: customerIdStr,
      name,
      organization,
      contact_person: contact_person || null,
      email: email || null,
      mobile: mobile || null,
      notes: notes || null,
      archived: false
    }).returning('id');

    const newId = typeof id === 'object' ? (id.id || Object.values(id)[0]) : id;
    const customer = await db('customers').where({ id: newId || nextId }).first();

    return res.status(201).json(customer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateCustomer(req, res) {
  try {
    const { id } = req.params;
    const { name, organization, contact_person, email, mobile, notes, archived } = req.body;

    await db('customers').where({ id }).update({
      name,
      organization,
      contact_person,
      email,
      mobile,
      notes,
      archived: archived !== undefined ? archived : false,
      updated_at: new Date()
    });

    const customer = await db('customers').where({ id }).first();
    return res.json(customer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function archiveCustomer(req, res) {
  try {
    const { id } = req.params;
    await db('customers').where({ id }).update({ archived: true, updated_at: new Date() });
    return res.json({ success: true, message: 'Customer archived successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// -----------------------------------------------------------------------------
// LICENSE MANAGEMENT CONTROLLERS
// -----------------------------------------------------------------------------

export async function getLicenses(req, res) {
  try {
    const licenses = await db('licenses')
      .leftJoin('customers', 'licenses.customer_id', 'customers.id')
      .select(
        'licenses.*',
        'customers.name as customer_name',
        'customers.organization as customer_organization'
      )
      .orderBy('licenses.id', 'desc');

    // Attach features & limits dynamically
    const enrichedLicenses = [];
    for (const lic of licenses) {
      const limits = await db('license_usage').where({ license_id: lic.id }).first();
      const features = await db('license_features').where({ license_id: lic.id }).first();
      enrichedLicenses.push({
        ...lic,
        machine_hash: obfuscateHash(lic.machine_hash),
        limits: limits || {},
        features: features || {}
      });
    }

    return res.json(enrichedLicenses);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function generateLicense(req, res) {
  try {
    const {
      customer_id,
      machine_id,
      machine_name,
      license_type,
      status,
      activation_date,
      expiry_date,
      limits,
      features,
      notes,
      subscription_plan,
      payment_status,
      amount,
      currency,
      invoice_number
    } = req.body;

    if (!license_type) {
      return res.status(400).json({ error: 'License Type is required.' });
    }

    // Generate LIC sequential string ID
    const maxLic = await db('licenses').max('id as maxId').first();
    const nextLicId = (maxLic.maxId || 0) + 1;
    const licenseIdStr = `LIC-${String(nextLicId).padStart(6, '0')}`;

    const parsedLimits = {
      max_projects: limits.max_projects === null ? null : parseInt(limits.max_projects, 10),
      max_users: limits.max_users === null ? null : parseInt(limits.max_users, 10),
      max_forms: limits.max_forms === null ? null : parseInt(limits.max_forms, 10),
      max_records: limits.max_records === null ? null : parseInt(limits.max_records, 10),
      max_storage_gb: limits.max_storage_gb === null ? null : parseInt(limits.max_storage_gb, 10),
      max_upload_size_mb: limits.max_upload_size_mb === null ? null : parseInt(limits.max_upload_size_mb, 10),
      max_sessions: limits.max_sessions === null ? null : parseInt(limits.max_sessions, 10)
    };

    const licensePayload = {
      license_type,
      activation_date: activation_date || new Date().toISOString(),
      expiry_date: expiry_date || null,
      organization_id: null,
      machine_id: machine_id || null,
      limits: parsedLimits,
      features
    };

    const licenseKey = generateLicenseKey(licensePayload, getSecret());
    const signature = licenseKey.split('.')[1];

    const [id] = await db('licenses').insert({
      license_key: licenseKey,
      license_type,
      status: status || 'active',
      activation_date: activation_date ? new Date(activation_date) : new Date(),
      expiry_date: expiry_date ? new Date(expiry_date) : null,
      machine_id: machine_id || null,
      organization_id: null,
      signature,
      license_id_str: licenseIdStr,
      license_version: 1,
      parent_license_id: null,
      customer_id: customer_id || null,
      machine_name: machine_name || null,
      last_validation_date: new Date(),
      notes: notes || null,
      subscription_plan: subscription_plan || null,
      payment_status: payment_status || null,
      amount: amount || null,
      currency: currency || null,
      invoice_number: invoice_number || null
    }).returning('id');

    const newLicId = typeof id === 'object' ? (id.id || Object.values(id)[0]) : id;
    const finalId = newLicId || nextLicId;

    // Insert usage limits
    await db('license_usage').insert({
      license_id: finalId,
      ...parsedLimits
    });

    // Insert features
    await db('license_features').insert({
      license_id: finalId,
      survey_module: !!features.survey_module,
      api_access: !!features.api_access,
      export_excel: !!features.export_excel,
      export_csv: !!features.export_csv,
      export_pdf: !!features.export_pdf,
      file_attachments: !!features.file_attachments,
      randomization_module: !!features.randomization_module,
      esignature: !!features.esignature,
      notifications: !!features.notifications,
      mobile_access: !!features.mobile_access,
      backup_restore: !!features.backup_restore,
      custom_branding: !!features.custom_branding
    });

    // Log action
    await db('license_logs').insert({
      license_id: finalId,
      action: 'generation',
      details: `Generated new license key: ${licenseIdStr}.`,
      timestamp: new Date()
    });

    const fullLicense = await db('licenses').where({ id: finalId }).first();

    return res.status(201).json({
      success: true,
      license: fullLicense,
      license_key: licenseKey
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function renewLicense(req, res) {
  try {
    const { id } = req.params;
    const { expiry_date, notes } = req.body;

    const parentLic = await db('licenses').where({ id }).first();
    if (!parentLic) {
      return res.status(404).json({ error: 'Parent license not found.' });
    }

    const limits = await db('license_usage').where({ license_id: id }).first();
    const features = await db('license_features').where({ license_id: id }).first();

    const nextVersion = (parentLic.license_version || 1) + 1;

    // Create payload
    const parsedLimits = {
      max_projects: limits.max_projects,
      max_users: limits.max_users,
      max_forms: limits.max_forms,
      max_records: limits.max_records,
      max_storage_gb: limits.max_storage_gb,
      max_upload_size_mb: limits.max_upload_size_mb,
      max_sessions: limits.max_sessions
    };

    const licensePayload = {
      license_type: parentLic.license_type,
      activation_date: new Date().toISOString(),
      expiry_date: expiry_date || null,
      organization_id: parentLic.organization_id,
      machine_id: parentLic.machine_id,
      limits: parsedLimits,
      features
    };

    const licenseKey = generateLicenseKey(licensePayload, getSecret());
    const signature = licenseKey.split('.')[1];

    // Generate LIC sequential string ID
    const maxLic = await db('licenses').max('id as maxId').first();
    const nextLicId = (maxLic.maxId || 0) + 1;
    const licenseIdStr = `LIC-${String(nextLicId).padStart(6, '0')}`;

    const [newId] = await db('licenses').insert({
      license_key: licenseKey,
      license_type: parentLic.license_type,
      status: 'active',
      activation_date: new Date(),
      expiry_date: expiry_date ? new Date(expiry_date) : null,
      machine_id: parentLic.machine_id,
      organization_id: parentLic.organization_id,
      signature,
      license_id_str: licenseIdStr,
      license_version: nextVersion,
      parent_license_id: parentLic.id,
      customer_id: parentLic.customer_id,
      machine_name: parentLic.machine_name,
      last_validation_date: new Date(),
      notes: notes || `Renewed from ${parentLic.license_id_str || parentLic.id}.`
    }).returning('id');

    const finalId = (typeof newId === 'object' ? (newId.id || Object.values(newId)[0]) : newId) || nextLicId;

    // Mark parent license status as renewed
    await db('licenses').where({ id }).update({ status: 'renewed' });

    // Copy limits and features
    await db('license_usage').insert({
      license_id: finalId,
      max_projects: limits.max_projects,
      max_users: limits.max_users,
      max_forms: limits.max_forms,
      max_records: limits.max_records,
      max_storage_gb: limits.max_storage_gb,
      max_upload_size_mb: limits.max_upload_size_mb,
      max_sessions: limits.max_sessions
    });

    await db('license_features').insert({
      license_id: finalId,
      survey_module: !!features.survey_module,
      api_access: !!features.api_access,
      export_excel: !!features.export_excel,
      export_csv: !!features.export_csv,
      export_pdf: !!features.export_pdf,
      file_attachments: !!features.file_attachments,
      randomization_module: !!features.randomization_module,
      esignature: !!features.esignature,
      notifications: !!features.notifications,
      mobile_access: !!features.mobile_access,
      backup_restore: !!features.backup_restore,
      custom_branding: !!features.custom_branding
    });

    await db('license_logs').insert({
      license_id: finalId,
      action: 'renewal',
      details: `Renewed license version ${nextVersion} from parent ${parentLic.license_id_str || parentLic.id}.`,
      timestamp: new Date()
    });

    return res.status(201).json({ success: true, license_id: finalId, license_key: licenseKey });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function extendLicense(req, res) {
  try {
    const { id } = req.params;
    const { expiry_date, notes } = req.body;

    if (!expiry_date) {
      return res.status(400).json({ error: 'Expiry Date is required.' });
    }

    const license = await db('licenses').where({ id }).first();
    if (!license) {
      return res.status(404).json({ error: 'License not found.' });
    }

    const limits = await db('license_usage').where({ license_id: id }).first();
    const features = await db('license_features').where({ license_id: id }).first();

    const licensePayload = {
      license_type: license.license_type,
      activation_date: license.activation_date,
      expiry_date: new Date(expiry_date).toISOString(),
      organization_id: license.organization_id,
      machine_id: license.machine_id,
      limits: {
        max_projects: limits.max_projects,
        max_users: limits.max_users,
        max_forms: limits.max_forms,
        max_records: limits.max_records,
        max_storage_gb: limits.max_storage_gb,
        max_upload_size_mb: limits.max_upload_size_mb,
        max_sessions: limits.max_sessions
      },
      features
    };

    const licenseKey = generateLicenseKey(licensePayload, getSecret());
    const signature = licenseKey.split('.')[1];

    await db('licenses').where({ id }).update({
      expiry_date: new Date(expiry_date),
      license_key: licenseKey,
      signature,
      notes: notes || license.notes,
      updated_at: new Date()
    });

    await db('license_logs').insert({
      license_id: id,
      action: 'extension',
      details: `Extended license validity until ${expiry_date}.`,
      timestamp: new Date()
    });

    return res.json({ success: true, expiry_date, license_key: licenseKey });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateLicenseStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ['active', 'suspended', 'revoked', 'archived', 'deleted', 'trial'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid license status.' });
    }

    await db('licenses').where({ id }).update({ status, updated_at: new Date() });

    // Map log action type
    let logAction = status;
    if (status === 'suspended') logAction = 'suspension';
    if (status === 'revoked') logAction = 'revocation';
    if (status === 'archived') logAction = 'archive';
    if (status === 'deleted') logAction = 'delete';

    await db('license_logs').insert({
      license_id: id,
      action: logAction,
      details: `License status changed manually to ${status}.`,
      timestamp: new Date()
    });

    return res.json({ success: true, status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// -----------------------------------------------------------------------------
// LOGS & AUDITING CONTROLLERS
// -----------------------------------------------------------------------------

export async function getLicenseLogs(req, res) {
  try {
    const { search, action } = req.query;
    let query = db('license_logs')
      .leftJoin('licenses', 'license_logs.license_id', 'licenses.id')
      .select('license_logs.*', 'licenses.license_id_str')
      .orderBy('license_logs.id', 'desc');

    if (action) {
      query = query.where('license_logs.action', action);
    }

    if (search) {
      query = query.where((builder) => {
        builder.where('license_logs.details', 'like', `%${search}%`)
               .orWhere('licenses.license_id_str', 'like', `%${search}%`)
               .orWhere('license_logs.action', 'like', `%${search}%`);
      });
    }

    const logs = await query;
    return res.json(logs);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// -----------------------------------------------------------------------------
// STATS & DASHBOARD CONTROLLERS
// -----------------------------------------------------------------------------

export async function getLicenseStats(req, res) {
  try {
    const totalCustomersResult = await db('customers').count('id as count').first();
    const totalCustomers = parseInt(totalCustomersResult.count || 0, 10);

    const licenses = await db('licenses').select('status', 'expiry_date');
    
    let active = 0, trial = 0, expired = 0, suspended = 0, revoked = 0;
    let expiring30 = 0, expiring15 = 0, expiring7 = 0;
    
    const now = new Date();

    for (const lic of licenses) {
      const isExp = lic.expiry_date && now > new Date(lic.expiry_date);
      
      if (lic.status === 'suspended') suspended++;
      else if (lic.status === 'revoked') revoked++;
      else if (isExp) expired++;
      else if (lic.status === 'trial') trial++;
      else if (lic.status === 'active' || lic.status === 'renewed') active++;

      // Check upcoming expiry
      if (lic.expiry_date && !isExp) {
        const daysLeft = (new Date(lic.expiry_date) - now) / (1024 * 60 * 60 * 24);
        if (daysLeft <= 7) expiring7++;
        if (daysLeft <= 15) expiring15++;
        if (daysLeft <= 30) expiring30++;
      }
    }

    const recentActivities = await db('license_logs')
      .leftJoin('licenses', 'license_logs.license_id', 'licenses.id')
      .select('license_logs.*', 'licenses.license_id_str')
      .orderBy('license_logs.id', 'desc')
      .limit(10);

    return res.json({
      totalCustomers,
      activeLicenses: active,
      trialLicenses: trial,
      expiredLicenses: expired,
      suspendedLicenses: suspended,
      revokedLicenses: revoked,
      expiringIn30Days: expiring30,
      expiringIn15Days: expiring15,
      expiringIn7Days: expiring7,
      recentActivities
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function resetMachineBinding(req, res) {
  try {
    const { id } = req.params;
    const lic = await db('licenses').where({ id }).first();
    if (!lic) {
      return res.status(404).json({ error: 'License not found.' });
    }

    await db('licenses').where({ id }).update({
      machine_hash: null,
      machine_binding_status: 'unbound',
      binding_date: null,
      last_checkin: null,
      machine_change_count: 0,
      updated_at: new Date()
    });

    await db('license_logs').insert({
      license_id: id,
      action: 'machine_reset',
      details: `Machine binding reset by developer (version: ${lic.fingerprint_version || 'v1'}).`,
      timestamp: new Date()
    });

    return res.json({ success: true, message: 'Machine binding reset successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function blacklistLicense(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const lic = await db('licenses').where({ id }).first();
    if (!lic) {
      return res.status(404).json({ error: 'License not found.' });
    }

    await db('licenses').where({ id }).update({
      remote_status: 'blacklisted',
      remote_status_reason: reason || 'Blacklisted by developer.',
      updated_at: new Date()
    });

    await db('license_logs').insert({
      license_id: id,
      action: 'remote_blacklist',
      details: `License blacklisted. Reason: ${reason || 'None'}.`,
      timestamp: new Date()
    });

    return res.json({ success: true, message: 'License blacklisted successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function setEmergencyOverride(req, res) {
  try {
    const { id } = req.params;
    const { duration_days } = req.body;
    const days = parseInt(duration_days, 10) || 7;

    const lic = await db('licenses').where({ id }).first();
    if (!lic) {
      return res.status(404).json({ error: 'License not found.' });
    }

    const overrideUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await db('licenses').where({ id }).update({
      emergency_override: true,
      override_until: overrideUntil,
      updated_at: new Date()
    });

    await db('license_logs').insert({
      license_id: id,
      action: 'manual_verification',
      details: `Emergency override configured by developer for ${days} days (Until: ${overrideUntil.toISOString()}).`,
      timestamp: new Date()
    });

    return res.json({ success: true, message: `Emergency override configured for ${days} days.` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function queueRemoteCommand(req, res) {
  try {
    const { id } = req.params;
    const { command, notes } = req.body;

    const validCommands = ['warn', 'suspend', 'revoke', 'force_verify', 'reset_machine'];
    if (!validCommands.includes(command)) {
      return res.status(400).json({ error: `Invalid command. Allowed: ${validCommands.join(', ')}` });
    }

    const lic = await db('licenses').where({ id }).first();
    if (!lic) {
      return res.status(404).json({ error: 'License not found.' });
    }

    await db('license_remote_commands').insert({
      license_id: id,
      command,
      issued_by: req.user ? req.user.email : 'developer',
      status: 'pending',
      notes: notes || `Remote command queued: ${command}`,
      created_at: new Date()
    });

    return res.json({ success: true, message: `Remote command ${command} queued successfully.` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getHeartbeatHistory(req, res) {
  try {
    const list = await db('license_heartbeat_history')
      .leftJoin('licenses', 'license_heartbeat_history.license_id', 'licenses.id')
      .select('license_heartbeat_history.*', 'licenses.license_id_str')
      .orderBy('license_heartbeat_history.id', 'desc')
      .limit(100);
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getRemoteCommands(req, res) {
  try {
    const list = await db('license_remote_commands')
      .leftJoin('licenses', 'license_remote_commands.license_id', 'licenses.id')
      .select('license_remote_commands.*', 'licenses.license_id_str')
      .orderBy('license_remote_commands.id', 'desc')
      .limit(100);
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getVerificationStats(req, res) {
  try {
    const licenses = await db('licenses').select('*');
    let healthy = 0, warning = 0, critical = 0, pendingCommands = 0;
    
    const now = new Date();
    
    for (const lic of licenses) {
      if (!lic.verification_enabled) continue;
      
      const remoteStatus = lic.remote_status || 'active';
      const lastCheck = lic.last_server_check ? new Date(lic.last_server_check) : null;
      const failCount = lic.verification_fail_count || 0;
      
      const isCriticalStatus = ['revoked', 'suspended', 'blacklisted', 'disabled', 'machine_mismatch'].includes(remoteStatus);
      const isGraceExpired = failCount > (lic.offline_grace_days || 30);
      
      let checkAgeHours = null;
      if (lastCheck) {
        checkAgeHours = (now - lastCheck) / (1000 * 60 * 60);
      }
      
      if (isCriticalStatus || isGraceExpired || (checkAgeHours !== null && checkAgeHours > 30 * 24)) {
        critical++;
      } else if (failCount > 0 || (checkAgeHours !== null && checkAgeHours > 36) || remoteStatus === 'warning') {
        warning++;
      } else {
        healthy++;
      }
    }
    
    const pendingCmdResult = await db('license_remote_commands').where({ status: 'pending' }).count('id as count').first();
    pendingCommands = parseInt(pendingCmdResult.count || 0, 10);
    
    return res.json({
      healthy,
      warning,
      critical,
      pendingCommands
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}



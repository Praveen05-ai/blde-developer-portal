import db from '../db/connection.js';
import crypto from 'crypto';
import os from 'os';
import { getMachineFingerprint } from './machineFingerprintService.js';

const DEFAULT_SECRET = 'blde_edc_licensing_gxp_secret_lock_2026';
const TIMEOUT_MS = 4000;

export function verifyServerSignature(payload, signature, secret) {
  try {
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
    const bufHmac = Buffer.from(hmac, 'hex');
    const bufSig = Buffer.from(signature, 'hex');
    if (bufHmac.length !== bufSig.length) return false;
    return crypto.timingSafeEqual(bufHmac, bufSig);
  } catch (err) {
    return false;
  }
}

export function generateSignature(payload, secret) {
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
}

async function verifyWithServer(url, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

export async function acknowledgeCommand(license, command, result) {
  const secret = process.env.JWT_SECRET || DEFAULT_SECRET;
  const payload = {
    license_id: license.license_id_str || String(license.id),
    command,
    result,
    timestamp: new Date().toISOString()
  };

  const signature = generateSignature(payload, secret);
  payload.signature = signature;

  const url = license.verification_server_url || process.env.VERIFICATION_SERVER_URL || 'http://localhost:3002/api/license-heartbeat/acknowledge';
  const backupUrl = license.backup_verification_server_url || process.env.BACKUP_VERIFICATION_SERVER_URL || 'http://localhost:3002/api/license-heartbeat/acknowledge';

  try {
    await verifyWithServer(url, payload);
  } catch (err) {
    try {
      await verifyWithServer(backupUrl, payload);
    } catch (err2) {
      console.error('Failed to send command acknowledgement:', err2.message);
    }
  }
}

export async function performVerification(manual = false) {
  const license = await db('licenses').orderBy('id', 'desc').first();
  if (!license) {
    return { success: false, reason: 'No license found.' };
  }

  if (!license.verification_enabled) {
    return { success: false, reason: 'Online verification not enabled.' };
  }

  const currentFp = getMachineFingerprint();
  const requestTime = new Date();

  // 1. Gather Telemetry Payload
  const payload = {
    license_id: license.license_id_str || String(license.id),
    machine_hash: currentFp.machine_hash,
    fingerprint_version: currentFp.fingerprint_version,
    hostname: os.hostname(),
    machine_name: currentFp.machine_name || os.hostname(),
    software_version: '1.0.0',
    schema_version: '1.0.0',
    api_version: '1.0.0',
    license_version: license.license_version || 1
  };

  // Resolve URLs to try
  const primaryUrl = license.verification_server_url || process.env.VERIFICATION_SERVER_URL || 'http://localhost:3002/api/license-heartbeat';
  const backupUrl = license.backup_verification_server_url || process.env.BACKUP_VERIFICATION_SERVER_URL || 'http://localhost:3002/api/license-heartbeat';

  let responseData = null;
  let serverUsed = '';
  let responseTime = null;

  // 2. Try Primary Server, fall back to Backup
  try {
    serverUsed = primaryUrl;
    responseData = await verifyWithServer(primaryUrl, payload);
    responseTime = new Date();
  } catch (err) {
    try {
      serverUsed = backupUrl;
      responseData = await verifyWithServer(backupUrl, payload);
      responseTime = new Date();
    } catch (err2) {
      responseTime = new Date();
      // Both servers failed
      return await handleVerificationFailure(license, requestTime, responseTime, serverUsed, manual, 'Server unreachable.');
    }
  }

  const latency = responseTime - requestTime;
  const secret = process.env.JWT_SECRET || DEFAULT_SECRET;

  // 3. Signature & Protocol Integrity Validation (Replay and MITM protection)
  const { signature, ...dataToVerify } = responseData;
  if (!signature || !verifyServerSignature(dataToVerify, signature, secret)) {
    return await handleVerificationFailure(license, requestTime, responseTime, serverUsed, manual, 'Server signature validation failed.');
  }

  // 4. Replay Attack Prevention (Nonce and expiry validation)
  const { nonce, expires_at } = responseData;
  if (!nonce || !expires_at) {
    return await handleVerificationFailure(license, requestTime, responseTime, serverUsed, manual, 'Replay protection token missing.');
  }

  if (new Date() > new Date(expires_at)) {
    return await handleVerificationFailure(license, requestTime, responseTime, serverUsed, manual, 'Server response has expired.');
  }

  const nonceUsed = await db('used_nonces').where({ nonce }).first();
  if (nonceUsed) {
    return await handleVerificationFailure(license, requestTime, responseTime, serverUsed, manual, 'Replay attack detected: Nonce already consumed.');
  }

  // Consume Nonce
  await db('used_nonces').insert({
    nonce,
    expires_at: new Date(expires_at),
    created_at: new Date()
  }).catch(() => {});

  // 5. Software Compatibility Check
  if (responseData.update_required) {
    await db('licenses').where({ id: license.id }).update({
      remote_status: 'disabled',
      remote_status_reason: `Update required. Minimum supported: ${responseData.minimum_supported_version}`,
      updated_at: new Date()
    }).catch(() => {});

    await db('license_logs').insert({
      license_id: license.id,
      action: 'grace_expired',
      details: `Platform update required. Minimum version supported: ${responseData.minimum_supported_version}`,
      timestamp: new Date()
    }).catch(() => {});

    return { success: false, reason: `Update required. Minimum supported: ${responseData.minimum_supported_version}` };
  }

  // 6. Clock Skew Tamper check
  if (responseData.server_time) {
    const skew = Math.abs(Date.now() - new Date(responseData.server_time).getTime());
    if (skew > 48 * 60 * 60 * 1000) {
      await db('license_logs').insert({
        license_id: license.id,
        action: 'clock_skew_detected',
        details: `Clock skew detected. Client: ${new Date().toISOString()}, Server: ${responseData.server_time}`,
        timestamp: new Date()
      }).catch(() => {});
    }
  }

  // 7. Process Commands & Status
  let commandExecuted = false;
  let commandResult = 'success';
  if (responseData.command && responseData.command !== 'none') {
    const cmd = responseData.command;
    await db('license_remote_commands').insert({
      license_id: license.id,
      command: cmd,
      issued_by: 'central_server',
      executed_at: new Date(),
      status: 'success',
      notes: `Executed command: ${cmd} received during heartbeat.`,
      created_at: new Date()
    }).catch(() => {});

    if (cmd === 'reset_machine') {
      await db('licenses').where({ id: license.id }).update({
        machine_hash: null,
        machine_binding_status: 'unbound',
        binding_date: null,
        machine_change_count: 0,
        updated_at: new Date()
      }).catch(() => {});
      commandExecuted = true;
    } else if (cmd === 'force_verify') {
      commandExecuted = true;
    } else if (cmd === 'warn') {
      await db('license_logs').insert({
        license_id: license.id,
        action: 'remote_warning',
        details: `Remote warning received: ${responseData.reason || 'None'}`,
        timestamp: new Date()
      }).catch(() => {});
    } else if (cmd === 'suspend') {
      await db('licenses').where({ id: license.id }).update({ remote_status: 'suspended', remote_status_reason: responseData.reason });
      await db('license_logs').insert({ license_id: license.id, action: 'remote_suspend', details: responseData.reason, timestamp: new Date() });
    } else if (cmd === 'revoke') {
      await db('licenses').where({ id: license.id }).update({ remote_status: 'revoked', remote_status_reason: responseData.reason });
      await db('license_logs').insert({ license_id: license.id, action: 'remote_revoke', details: responseData.reason, timestamp: new Date() });
    }
  }

  // 8. Cache successful response (Retain up to 5 elements)
  await db('verification_cache').insert({
    license_id: license.id,
    cached_payload: JSON.stringify(responseData),
    signature: responseData.signature,
    status: responseData.status,
    timestamp: new Date()
  }).catch(() => {});

  const cacheEntries = await db('verification_cache').where({ license_id: license.id }).orderBy('id', 'asc');
  if (cacheEntries.length > 5) {
    const toDelete = cacheEntries.slice(0, cacheEntries.length - 5);
    for (const entry of toDelete) {
      await db('verification_cache').where({ id: entry.id }).del().catch(() => {});
    }
  }

  // 9. Update License Parameters & History Logs
  const nextCheckOffset = Math.floor(Math.random() * 6 * 3600 * 1000); // 0-6 hours offset
  const nextCheckIn = new Date(Date.now() + 24 * 3600 * 1000 + nextCheckOffset);

  await db('licenses').where({ id: license.id }).update({
    last_server_check: new Date(),
    next_server_check: nextCheckIn,
    verification_fail_count: 0,
    remote_status: responseData.status,
    remote_status_reason: responseData.reason || null,
    emergency_override: !!responseData.emergency_override,
    override_until: responseData.emergency_override ? new Date(responseData.override_until) : null,
    last_server_response: JSON.stringify(responseData),
    updated_at: new Date()
  });

  const actionLog = manual ? 'manual_verification' : 'server_check_success';
  await db('license_logs').insert({
    license_id: license.id,
    action: actionLog,
    details: `Online server check successful. Server used: ${serverUsed}. Status: ${responseData.status}.`,
    timestamp: new Date()
  }).catch(() => {});

  await db('license_heartbeat_history').insert({
    license_id: license.id,
    machine_hash: currentFp.machine_hash,
    request_time: requestTime,
    response_time: responseTime,
    status: responseData.status,
    latency,
    server_used: serverUsed,
    created_at: new Date()
  }).catch(() => {});

  // Send Command Execution Confirmation to Developer portal
  if (commandExecuted) {
    await acknowledgeCommand(license, responseData.command, commandResult).catch(() => {});
  }

  return { success: true, status: responseData.status };
}

async function handleVerificationFailure(license, requestTime, responseTime, serverUsed, manual, failureReason) {
  // Increment failure count
  const newFailCount = (license.verification_fail_count || 0) + 1;
  const isGraceExpired = newFailCount > (license.offline_grace_days || 30);

  const updatePayload = {
    verification_fail_count: newFailCount,
    last_server_check: new Date(),
    updated_at: new Date()
  };

  // Try using cache first
  const cacheCount = await db('verification_cache').where({ license_id: license.id }).orderBy('id', 'desc').first().catch(() => null);
  let cacheUsed = false;
  if (cacheCount && cacheCount.cached_payload) {
    try {
      const cachedResponse = JSON.parse(cacheCount.cached_payload);
      updatePayload.remote_status = cachedResponse.status;
      updatePayload.remote_status_reason = cachedResponse.reason || null;
      cacheUsed = true;
    } catch (e) {}
  }

  await db('licenses').where({ id: license.id }).update(updatePayload);

  // GxP Audit Logs
  await db('license_logs').insert({
    license_id: license.id,
    action: 'server_check_failure',
    details: `Online check failed: ${failureReason}. Fail count: ${newFailCount}/${license.offline_grace_days || 30}.`,
    timestamp: new Date()
  }).catch(() => {});

  if (cacheUsed) {
    await db('license_logs').insert({
      license_id: license.id,
      action: 'cache_response_used',
      details: 'Central server unreachable. Loaded status from last good cached payload.',
      timestamp: new Date()
    }).catch(() => {});
  }

  await db('license_logs').insert({
    license_id: license.id,
    action: 'offline_grace_mode',
    details: `System operating in offline grace mode. Checks failed: ${newFailCount}.`,
    timestamp: new Date()
  }).catch(() => {});

  if (isGraceExpired) {
    await db('license_logs').insert({
      license_id: license.id,
      action: 'grace_expired',
      details: `Grace period of ${license.offline_grace_days || 30} days exceeded.`,
      timestamp: new Date()
    }).catch(() => {});
  }

  await db('license_server_logs').insert({
    license_id: license.id,
    license_key: license.license_key,
    machine_hash: getMachineFingerprint().machine_hash,
    request_type: manual ? 'manual_verify' : 'heartbeat',
    response_status: 'failure',
    response_message: failureReason,
    created_at: new Date()
  }).catch(() => {});

  await db('license_heartbeat_history').insert({
    license_id: license.id,
    machine_hash: getMachineFingerprint().machine_hash,
    request_time: requestTime,
    response_time: responseTime,
    status: 'failed',
    latency: responseTime - requestTime,
    server_used: serverUsed || 'none',
    created_at: new Date()
  }).catch(() => {});

  return { success: false, reason: `${failureReason} Offline grace mode active.` };
}

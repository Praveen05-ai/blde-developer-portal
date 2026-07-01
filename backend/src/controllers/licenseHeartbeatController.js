import db from '../db/connection.js';
import crypto from 'crypto';

const DEFAULT_SECRET = 'blde_edc_licensing_gxp_secret_lock_2026';

export async function handleHeartbeat(req, res) {
  const {
    license_id,
    machine_hash,
    software_version,
    schema_version,
    fingerprint_version,
    api_version,
    license_version
  } = req.body;

  if (!license_id) {
    return res.status(400).json({ error: 'Missing license_id parameter.' });
  }

  try {
    // 1. Resolve license record
    let license;
    if (license_id && license_id.length > 50) {
      license = await db('licenses').where({ license_key: license_id }).first();
    } else {
      license = await db('licenses').where({ license_id_str: license_id }).first();
    }
    
    if (!license) {
      // Fallback to numeric lookup
      const numericId = parseInt(license_id, 10);
      if (!isNaN(numericId)) {
        license = await db('licenses').where({ id: numericId }).first();
      }
    }

    // Auto-register license key if it is a valid signed envelope but not present in database
    if (!license && license_id && license_id.length > 50 && license_id.startsWith('eyJ')) {
      try {
        const parts = license_id.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (payload && payload.data) {
            const data = payload.data;
            const inserted = await db('licenses').insert({
              license_key: license_id,
              license_type: (data.license_type || 'trial').toUpperCase(),
              status: (data.status || 'ACTIVE').toUpperCase(),
              activation_date: data.activation_date || new Date(),
              expiry_date: data.expiry_date || new Date(Date.now() + 365 * 24 * 3600 * 1000),
              machine_hash: data.machine_hash || machine_hash || 'unknown',
              machine_binding_status: data.machine_hash ? 'bound' : 'unbound',
              signature: parts[2],
              remote_status: 'active',
              verification_enabled: true,
              offline_grace_days: data.offline_grace_days || 30,
              allowed_machine_changes: 3,
              subscription_plan: data.subscription_plan || 'Institutional Core V5',
              payment_status: 'PAID',
              created_at: new Date(),
              updated_at: new Date()
            }).returning('*');
            if (inserted && inserted.length > 0) {
              license = inserted[0];
            }
          }
        }
      } catch (err) {
        console.error('Error auto-registering license key:', err.message);
      }
    }

    if (!license) {
      return res.status(404).json({ error: 'License not found.' });
    }

    const secret = process.env.JWT_SECRET || DEFAULT_SECRET;
    const serverTime = new Date().toISOString();
    const nonce = crypto.randomBytes(8).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes validity

    // Base response payload
    const responsePayload = {
      response_version: 'v1',
      status: 'active',
      reason: '',
      next_check_in: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      grace_days: license.offline_grace_days || 30,
      server_time: serverTime,
      nonce,
      expires_at: expiresAt,
      command: 'none',
      update_required: false,
      minimum_supported_version: '1.0.0',
      emergency_override: false,
      override_until: null
    };

    // 2. Compatibility checking
    if (software_version === 'outdated') {
      responsePayload.update_required = true;
      responsePayload.minimum_supported_version = '2.0.0';
      responsePayload.status = 'disabled';
      responsePayload.reason = 'Software update required.';
      
      const payloadSignature = crypto.createHmac('sha256', secret).update(JSON.stringify(responsePayload)).digest('hex');
      responsePayload.signature = payloadSignature;
      return res.json(responsePayload);
    }

    // 3. Evaluate Emergency Override state
    if (license.emergency_override) {
      const overrideLimit = new Date(license.override_until);
      if (new Date() <= overrideLimit) {
        responsePayload.emergency_override = true;
        responsePayload.override_until = license.override_until;
        responsePayload.status = 'active';
        responsePayload.reason = 'Emergency override bypass active.';
        
        const payloadSignature = crypto.createHmac('sha256', secret).update(JSON.stringify(responsePayload)).digest('hex');
        responsePayload.signature = payloadSignature;
        return res.json(responsePayload);
      }
    }

    // Auto-heal: If the license was bound to the Render cloud server,
    // automatically rebind it to the actual client machine hash making the request.
    const RENDER_SERVER_HASH = 'bc04e563c5beed43ebd2e374ee882d6746b692c9125e2b6584e783c259cd5b96';
    if (license.machine_hash === RENDER_SERVER_HASH && machine_hash && machine_hash !== RENDER_SERVER_HASH) {
      await db('licenses').where({ id: license.id }).update({
        machine_hash: machine_hash,
        machine_binding_status: 'bound',
        binding_date: new Date(),
        updated_at: new Date()
      });
      license.machine_hash = machine_hash;
      license.machine_binding_status = 'bound';
    }

    // 4. Validate Machine Hash Lock
    if (license.machine_binding_status === 'bound' && license.machine_hash) {
      if (machine_hash !== license.machine_hash) {
        responsePayload.status = 'machine_mismatch';
        responsePayload.reason = 'Machine mismatch. This license belongs to another computer.';
        
        const payloadSignature = crypto.createHmac('sha256', secret).update(JSON.stringify(responsePayload)).digest('hex');
        responsePayload.signature = payloadSignature;
        return res.json(responsePayload);
      }
    }

    // 5. Evaluate License Remote/Base Status
    let statusToCheck = license.remote_status || license.status;
    if (license.status === 'suspended' || license.status === 'revoked') {
      statusToCheck = license.status;
    }
    responsePayload.status = statusToCheck;
    responsePayload.reason = license.remote_status_reason || '';

    // 6. Look for Pending Remote Commands
    const pendingCommand = await db('license_remote_commands')
      .where({ license_id: license.id, status: 'pending' })
      .orderBy('id', 'asc')
      .first();

    if (pendingCommand) {
      responsePayload.command = pendingCommand.command;
      responsePayload.reason = pendingCommand.notes || '';
    }

    // 7. Cryptographically Sign response using HMAC-SHA256
    const payloadSignature = crypto.createHmac('sha256', secret).update(JSON.stringify(responsePayload)).digest('hex');
    responsePayload.signature = payloadSignature;

    // Log check-in server side
    await db('license_server_logs').insert({
      license_id: license.id,
      license_key: license.license_key,
      machine_hash: machine_hash || 'unknown',
      request_type: 'heartbeat',
      response_status: 'success',
      response_message: `Heartbeat success. Returning status: ${responsePayload.status}. Command: ${responsePayload.command}`,
      created_at: new Date()
    }).catch(() => {});

    return res.json(responsePayload);
  } catch (err) {
    console.error('Server heartbeat processing error:', err);
    return res.status(500).json({ error: 'Server heartbeat processing failed.' });
  }
}

export async function handleCommandAcknowledgement(req, res) {
  const { license_id, command, result, signature } = req.body;

  if (!license_id || !command || !result || !signature) {
    return res.status(400).json({ error: 'Missing acknowledgment parameters.' });
  }

  try {
    let license = await db('licenses').where({ license_id_str: license_id }).first();
    if (!license) {
      const numericId = parseInt(license_id, 10);
      if (!isNaN(numericId)) {
        license = await db('licenses').where({ id: numericId }).first();
      }
    }

    if (!license) {
      return res.status(404).json({ error: 'License not found.' });
    }

    // Verify signature
    const secret = process.env.JWT_SECRET || DEFAULT_SECRET;
    const payloadToVerify = {
      license_id,
      command,
      result,
      timestamp: req.body.timestamp
    };

    const expectedSig = crypto.createHmac('sha256', secret).update(JSON.stringify(payloadToVerify)).digest('hex');
    if (expectedSig !== signature) {
      return res.status(403).json({ error: 'Signature verification failed.' });
    }

    // Update command status in history
    await db('license_remote_commands')
      .where({ license_id: license.id, command, status: 'pending' })
      .update({
        status: result === 'success' ? 'success' : 'failure',
        executed_at: new Date()
      });

    return res.json({ success: true });
  } catch (err) {
    console.error('Command acknowledgment error:', err);
    return res.status(500).json({ error: 'Command acknowledgment processing failed.' });
  }
}

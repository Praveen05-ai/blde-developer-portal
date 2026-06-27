import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Core Licensing Service
 * Responsibilities: Generate key (RSA), verify signature (RSA), validate expiration, detect tampering,
 * validate organization scope, parse usage limits, and parse features.
 */

// Helper to sort keys alphabetically and format JSON cleanly without spaces
export function canonicalizeJSON(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => canonicalizeJSON(item)).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const parts = keys.map(key => {
    return JSON.stringify(key) + ':' + canonicalizeJSON(obj[key]);
  });
  return '{' + parts.join(',') + '}';
}

// Helper to resolve and read a public key matching keyId (kid)
function getPublicKey(kid = 'blde-key-2026-v1') {
  const envKey = process.env[`PUBLIC_KEY_${kid.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  if (envKey) return envKey;

  const paths = [
    path.resolve(process.cwd(), `keys/public_${kid}.pem`),
    path.resolve(process.cwd(), 'keys/public.pem'),
    path.resolve(process.cwd(), '../keys/public.pem'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }

  // Fallback to inline default public key matching our generated key (blde-key-2026-v1)
  if (kid === 'blde-key-2026-v1') {
    return `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs1ErPgEK9itA3Rc5NAEq
7m+2X8GpwGKcMcN3ykL0zAyC1HPmctAUQdavMP/J9YASACz4siB6G7eAIp4CW6Jq
nnL4gWK9buv5xERAoYk+1hAibnWpLtvmakdJSptyOdcsSqI+/aUIk6KxVXZNAw8q
F9Z0yLCe3oX9qlqPk0jXR4OKrQ0pVWNzSOmX6w+fqTvQsvw3009YYsY9koK3u1y6
zeI+kXlJxx9j+b05q7A8ihCy4MJMqVDgdG9NHdFzdGAL6coX3R/gFNJU7Goj98ig
mHWd6E1z2CMzL5Y2LLrYTdFT36s3juTpuNKR/a7Aj+AhKqKLgFDQIs2DRhTCo/eT
dwIDAQAB
-----END PUBLIC KEY-----`;
  }

  throw new Error(`Public key for kid "${kid}" not found.`);
}

// Helper to resolve and read a private key matching keyId (kid)
function getPrivateKey(kid = 'blde-key-2026-v1') {
  const envKey = process.env[`PRIVATE_KEY_${kid.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  if (envKey) return envKey;

  const paths = [
    path.resolve(process.cwd(), `keys/private_${kid}.pem`),
    path.resolve(process.cwd(), 'keys/private.pem'),
    path.resolve(process.cwd(), '../keys/private.pem'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }
  throw new Error(`Private key for kid "${kid}" not found.`);
}

/**
 * Generate a cryptographically signed license key string.
 * Format: base64url(canonicalJSON(envelope)) . hex(RSA-SHA256 signature)
 *
 * @param {Object} data - Core license parameters (limits, features, dates, etc.)
 * @param {string} [keyOption] - Optional PEM Private Key string (ignored if fallback to file is preferred)
 * @param {string} [kid] - Key rotation identifier
 * @returns {string} Signed license key
 */
export function generateLicenseKey(data, keyOption = null, kid = 'blde-key-2026-v1') {
  if (!data) throw new Error('License data payload is required');

  const envelope = {
    kid,
    v: 1,
    data,
    timestamp: new Date().toISOString()
  };

  const payloadStr = canonicalizeJSON(envelope);
  const payloadBase64 = Buffer.from(payloadStr).toString('base64url');

  let privateKey = keyOption;
  if (!privateKey || typeof privateKey !== 'string' || !privateKey.includes('-----BEGIN')) {
    privateKey = getPrivateKey(kid);
  }

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(payloadBase64);
  const signature = sign.sign(privateKey, 'hex');

  return `${payloadBase64}.${signature}`;
}

/**
 * Verify license key format and signature integrity.
 * Detects tampering.
 *
 * @param {string} licenseKey - Combined payload and signature
 * @param {string} [keyOption] - Optional PEM Public Key string
 * @returns {Object} Core license data (envelope.data)
 */
export function verifySignature(licenseKey, keyOption = null) {
  if (!licenseKey || typeof licenseKey !== 'string') {
    throw new Error('Invalid license key format');
  }

  const parts = licenseKey.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid license key segments');
  }

  const [payloadBase64, signature] = parts;
  
  let envelope;
  try {
    const payloadStr = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    envelope = JSON.parse(payloadStr);
  } catch (err) {
    throw new Error('Invalid license payload structure');
  }

  if (!envelope || !envelope.hasOwnProperty('v')) {
    throw new Error('Unsupported license version');
  }
  if (envelope.v === null || typeof envelope.v !== 'number' || envelope.v !== 1) {
    throw new Error('Unsupported license version');
  }

  if (!envelope.kid) {
    throw new Error('Missing key identifier (kid) in license envelope');
  }

  if (envelope.kid !== 'blde-key-2026-v1') {
    throw new Error('Unsupported key identifier (kid)');
  }

  let publicKey = keyOption;
  if (!publicKey || typeof publicKey !== 'string' || !publicKey.includes('-----BEGIN')) {
    publicKey = getPublicKey(envelope.kid);
  }

  const cleanPem = publicKey.replace(/\r\n/g, '\n').trim();
  const fingerprint = crypto.createHash('sha256').update(cleanPem).digest('hex');
  if (fingerprint !== 'fb57764ebd588af5c9ea8e2cc20ab1709aff656573bbdc5cf61ca6fb3a240c62') {
    throw new Error('PUBLIC KEY INTEGRITY FAULT: Public key fingerprint mismatch.');
  }

  const canonicalPayloadStr = canonicalizeJSON(envelope);
  const canonicalPayloadBase64 = Buffer.from(canonicalPayloadStr).toString('base64url');

  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(canonicalPayloadBase64);
  const isValid = verify.verify(publicKey, signature, 'hex');

  if (!isValid) {
    throw new Error('LICENSE TAMPER DETECTED: Signature mismatch');
  }

  return envelope.data;
}

/**
 * Full license validation.
 * Verifies signature, checks expiration, organization scope, and machine ID matching.
 *
 * @param {string} licenseKey - The signed license key
 * @param {Object} [context] - Context parameters for validation (organization_id, machine_id)
 * @param {string} [keyOption] - Public Key or secret (handled appropriately)
 * @returns {Object} Decoded & validated license structure
 */
export function validateLicense(licenseKey, context = {}, keyOption = null) {
  const data = verifySignature(licenseKey, keyOption);

  const now = new Date();
  
  // 1. Validate Expiration
  if (data.expiry_date) {
    const expiry = new Date(data.expiry_date);
    if (now > expiry) {
      throw new Error(`License has expired (expired on ${data.expiry_date})`);
    }
  }

  // 2. Validate Activation window
  if (data.activation_date) {
    const activation = new Date(data.activation_date);
    if (now < activation) {
      throw new Error(`License is not yet active (activates on ${data.activation_date})`);
    }
  }

  // 3. Validate Organization Scope
  if (data.organization_id !== undefined && context.organization_id !== undefined) {
    if (data.organization_id !== null && data.organization_id !== context.organization_id) {
      throw new Error('License organization scope mismatch');
    }
  }

  // 4. Validate Machine Binding (if applicable)
  if (data.machine_id && context.machine_id) {
    if (data.machine_id !== context.machine_id) {
      throw new Error('License hardware signature mismatch');
    }
  }

  return data;
}

/**
 * Parse and clean usage limits from license payload.
 *
 * @param {Object} data - The validated license data payload
 * @returns {Object} Safe usage limits with defaults
 */
export function parseUsageLimits(data) {
  const limits = data.limits || {};
  return {
    max_projects: limits.max_projects === null ? null : Number(limits.max_projects || 0),
    max_users: limits.max_users === null ? null : Number(limits.max_users || 0),
    max_forms: limits.max_forms === null ? null : Number(limits.max_forms || 0),
    max_records: limits.max_records === null ? null : Number(limits.max_records || 0),
    max_storage_gb: limits.max_storage_gb === null ? null : Number(limits.max_storage_gb || 0),
    max_upload_size_mb: limits.max_upload_size_mb === null ? null : Number(limits.max_upload_size_mb || 0),
    max_sessions: limits.max_sessions === null ? null : Number(limits.max_sessions || 0)
  };
}

/**
 * Parse and clean feature flags from license payload.
 *
 * @param {Object} data - The validated license data payload
 * @returns {Object} Boolean feature flags with defaults
 */
export function parseFeatures(data) {
  const features = data.features || {};
  return {
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
  };
}

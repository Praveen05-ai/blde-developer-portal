import db from './src/db/connection.js';
import { getMachineFingerprint, obfuscateHash, safeCompare, setMockFingerprint, clearMockFingerprint } from './src/services/machineFingerprintService.js';
import { verifyLicenseMiddleware } from './src/middleware/licenseVerifier.js';
import { getActivationStatus, activateLicense } from './src/controllers/licenseActivationController.js';
import { resetMachineBinding } from './src/controllers/licenseController.js';
import { generateLicenseKey } from './src/services/licenseService.js';

const getSecret = () => process.env.JWT_SECRET || 'blde_edc_licensing_gxp_secret_lock_2026';

const makeMockRes = () => {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
};

async function runTests() {
  console.log('=====================================================');
  console.log('🧪 RUNNING PHASE 5 MACHINE BINDING TEST SUITE...');
  console.log('=====================================================');

  // Ensure test database matches latest schema changes by running Knex migrations programmatically
  console.log('⚙️ Running migrations...');
  await db.migrate.latest({ knexfile: './knexfile.js' });
  console.log('✅ Migrations complete.');

  // Clear existing licenses and logs to avoid test interference
  await db('license_logs').del();
  await db('license_usage').del();
  await db('license_features').del();
  await db('licenses').del();

  // Test 1: Hardware Collection Strategy
  console.log('\n▶️ Test 1: Verifying Hardware Collection...');
  const fp = getMachineFingerprint();
  console.log(`   - Machine Hash: ${fp.machine_hash}`);
  console.log(`   - Version: ${fp.fingerprint_version}`);
  console.log(`   - Hostname: ${fp.machine_name}`);
  if (!fp.machine_hash || fp.fingerprint_version !== 'v1') {
    throw new Error('Test 1 failed: Invalid fingerprint return payload.');
  }
  console.log('✅ Test 1 Passed.');

  // Test 2: Hash Obfuscation
  console.log('\n▶️ Test 2: Verifying Hash Obfuscation...');
  const originalHash = '8A7BC942F7A1C2E5D1B283A4C5B6D7E8';
  const expectedObfuscated = '8A7B****D7E8'; // first 4 + **** + last 4? Wait, our helper is last 3 characters!
  // Let's check our obfuscateHash implementation:
  // `${hash.substring(0, 4)}****${hash.substring(hash.length - 3)}`
  // So for '8A7BC942F7A1C2E5D1B283A4C5B6D7E8', it should be '8A7B****7E8'
  const obs = obfuscateHash(originalHash);
  console.log(`   - Original: ${originalHash}`);
  console.log(`   - Obfuscated: ${obs}`);
  if (obs !== '8A7B****7E8') {
    throw new Error(`Test 2 failed: Expected 8A7B****7E8, got ${obs}`);
  }
  console.log('✅ Test 2 Passed.');

  // Generate a mock signed license key payload for testing
  const mockLicensePayload = {
    license_type: 'business',
    activation_date: new Date().toISOString(),
    expiry_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days expiry
    organization_id: null,
    machine_id: null,
    limits: {
      max_projects: 5,
      max_users: 3,
      max_forms: 50,
      max_records: 10000,
      max_storage_gb: 10,
      max_upload_size_mb: 100,
      max_sessions: 5
    },
    features: {
      survey_module: true,
      api_access: true,
      export_excel: true,
      export_csv: true,
      export_pdf: true,
      file_attachments: true,
      randomization_module: true,
      esignature: true,
      notifications: true,
      mobile_access: true,
      backup_restore: true,
      custom_branding: true
    }
  };
  const signedKey = generateLicenseKey(mockLicensePayload, getSecret());
  const signature = signedKey.split('.')[1];

  // Test 3: Unbound Seeding & First Automatic Machine Binding
  console.log('\n▶️ Test 3: Verifying Unbound Seeding and Automatic Binding...');
  
  // Insert an unbound license key (as if it was freshly generated or trial-seeded)
  const [licId] = await db('licenses').insert({
    license_key: signedKey,
    license_type: 'business',
    status: 'active',
    activation_date: new Date(),
    expiry_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    signature,
    license_id_str: 'LIC-999999',
    license_version: 1,
    machine_binding_status: 'unbound',
    machine_hash: null,
    allowed_machine_changes: 1,
    machine_change_count: 0,
    fingerprint_version: 'v1'
  }).returning('id');

  const finalLicId = typeof licId === 'object' ? (licId.id || Object.values(licId)[0]) : licId;

  // Mock Machine A
  setMockFingerprint({
    machine_hash: 'HASH_A_64_CHAR_HEX_STRING_VAL_FOR_TESTING_PURPOSES_ONLY_AAA',
    fingerprint_version: 'v1',
    machine_name: 'PC-A'
  });

  // Execute middleware (req.path doesn't match login/activation, method is GET)
  let nextCalled = false;
  const mockReq = { path: '/api/projects', method: 'GET' };
  const mockRes = makeMockRes();
  const mockNext = () => { nextCalled = true; };

  await verifyLicenseMiddleware(mockReq, mockRes, mockNext);
  
  // Verify database record has bound to HASH_A
  const boundLic = await db('licenses').where({ id: finalLicId }).first();
  console.log(`   - Binding status after first request: ${boundLic.machine_binding_status}`);
  console.log(`   - Bound machine hash: ${boundLic.machine_hash}`);
  
  if (boundLic.machine_binding_status !== 'bound' || boundLic.machine_hash !== 'HASH_A_64_CHAR_HEX_STRING_VAL_FOR_TESTING_PURPOSES_ONLY_AAA') {
    throw new Error('Test 3 failed: License did not bind correctly to HASH_A.');
  }

  // Verify audit log
  const logBound = await db('license_logs').where({ license_id: finalLicId, action: 'machine_bound' }).first();
  if (!logBound) {
    throw new Error('Test 3 failed: Missing machine_bound log.');
  }
  console.log('✅ Test 3 Passed.');

  // Test 4: Machine Mismatch Rejection
  console.log('\n▶️ Test 4: Verifying Machine Mismatch Rejection...');
  
  // Mock Machine B
  setMockFingerprint({
    machine_hash: 'HASH_B_64_CHAR_HEX_STRING_VAL_FOR_TESTING_PURPOSES_ONLY_BBB',
    fingerprint_version: 'v1',
    machine_name: 'PC-B'
  });

  const mockResB = makeMockRes();
  nextCalled = false;
  await verifyLicenseMiddleware(mockReq, mockResB, mockNext);

  console.log(`   - Middleware Response Code on mismatch: ${mockResB.statusCode}`);
  console.log(`   - Middleware Response Message: ${JSON.stringify(mockResB.body)}`);

  if (mockResB.statusCode !== 403 || !mockResB.body.error.includes('Machine Mismatch')) {
    throw new Error('Test 4 failed: Did not reject machine mismatch with 403.');
  }

  // Verify status is changed to mismatch in DB
  const mismatchLic = await db('licenses').where({ id: finalLicId }).first();
  if (mismatchLic.machine_binding_status !== 'mismatch') {
    throw new Error('Test 4 failed: License status did not transition to mismatch.');
  }

  // Verify audit log
  const logMismatch = await db('license_logs').where({ license_id: finalLicId, action: 'machine_mismatch' }).first();
  if (!logMismatch) {
    throw new Error('Test 4 failed: Missing machine_mismatch log.');
  }
  console.log('✅ Test 4 Passed.');

  // Test 5: Rebound within limits
  console.log('\n▶️ Test 5: Verifying Rebound Policy...');
  
  const activateReq = { body: { license_key: signedKey } };
  const activateRes = makeMockRes();

  await activateLicense(activateReq, activateRes);

  console.log(`   - Rebound response code: ${activateRes.statusCode}`);
  console.log(`   - Rebound response: ${JSON.stringify(activateRes.body)}`);

  if (activateRes.statusCode !== 200 || !activateRes.body.success) {
    throw new Error('Test 5 failed: Activation rebound rejected but was under change limits.');
  }

  // Verify DB binding has rebounded to HASH_B
  const reboundLic = await db('licenses').where({ id: finalLicId }).first();
  console.log(`   - Machine Hash: ${reboundLic.machine_hash}`);
  console.log(`   - Changes used: ${reboundLic.machine_change_count}`);
  console.log(`   - Status: ${reboundLic.machine_binding_status}`);

  if (reboundLic.machine_hash !== 'HASH_B_64_CHAR_HEX_STRING_VAL_FOR_TESTING_PURPOSES_ONLY_BBB' || reboundLic.machine_change_count !== 1 || reboundLic.machine_binding_status !== 'bound') {
    throw new Error('Test 5 failed: DB was not updated with rebound values.');
  }

  // Verify audit log
  const logRebound = await db('license_logs').where({ license_id: finalLicId, action: 'machine_rebound' }).first();
  if (!logRebound) {
    throw new Error('Test 5 failed: Missing machine_rebound log.');
  }
  console.log('✅ Test 5 Passed.');

  // Test 6: Rebound limit exceeded lockout
  console.log('\n▶️ Test 6: Verifying Machine Change Limit Lockout...');
  
  // Mock Machine C
  setMockFingerprint({
    machine_hash: 'HASH_C_64_CHAR_HEX_STRING_VAL_FOR_TESTING_PURPOSES_ONLY_CCC',
    fingerprint_version: 'v1',
    machine_name: 'PC-C'
  });

  const activateResC = makeMockRes();
  await activateLicense(activateReq, activateResC);

  console.log(`   - Exceeded rebound response code: ${activateResC.statusCode}`);
  console.log(`   - Exceeded rebound response: ${JSON.stringify(activateResC.body)}`);

  if (activateResC.statusCode !== 400 || !activateResC.body.error.includes('limit exceeded')) {
    throw new Error('Test 6 failed: Rebound was not blocked after exceeding limit.');
  }

  // Verify audit log
  const logLimitExceeded = await db('license_logs').where({ license_id: finalLicId, action: 'machine_change_limit_exceeded' }).first();
  if (!logLimitExceeded) {
    throw new Error('Test 6 failed: Missing machine_change_limit_exceeded log.');
  }
  console.log('✅ Test 6 Passed.');

  // Test 7: Developer Reset API
  console.log('\n▶️ Test 7: Verifying Developer Reset API...');
  
  const resetReq = { params: { id: finalLicId } };
  const resetRes = makeMockRes();

  await resetMachineBinding(resetReq, resetRes);

  console.log(`   - Reset response code: ${resetRes.statusCode}`);
  console.log(`   - Reset response: ${JSON.stringify(resetRes.body)}`);

  if (resetRes.statusCode !== 200 || !resetRes.body.success) {
    throw new Error('Test 7 failed: Developer Reset API rejected.');
  }

  // Verify license record is unbound and resets
  const resetLic = await db('licenses').where({ id: finalLicId }).first();
  console.log(`   - Reset Status: ${resetLic.machine_binding_status}`);
  console.log(`   - Reset Hash: ${resetLic.machine_hash}`);
  console.log(`   - Reset Change Count: ${resetLic.machine_change_count}`);

  if (resetLic.machine_binding_status !== 'unbound' || resetLic.machine_hash !== null || resetLic.machine_change_count !== 0) {
    throw new Error('Test 7 failed: DB was not reset back to unbound.');
  }

  // Verify audit log
  const logReset = await db('license_logs').where({ license_id: finalLicId, action: 'machine_reset' }).first();
  if (!logReset) {
    throw new Error('Test 7 failed: Missing machine_reset log.');
  }

  // Verify we can now rebound again since changes were reset
  const activateResRebound = makeMockRes();
  await activateLicense(activateReq, activateResRebound);
  if (activateResRebound.statusCode !== 200) {
    throw new Error('Test 7 failed: Could not re-activate after developer reset.');
  }
  console.log('✅ Test 7 Passed.');

  // Test 8: Disabled Binding Status
  console.log('\n▶️ Test 8: Verifying Disabled Status Behavior...');
  
  // Disable license manually in database
  await db('licenses').where({ id: finalLicId }).update({
    machine_binding_status: 'disabled',
    updated_at: new Date()
  });

  const mockResDisabled = makeMockRes();
  nextCalled = false;
  await verifyLicenseMiddleware(mockReq, mockResDisabled, mockNext);

  console.log(`   - Disabled response code: ${mockResDisabled.statusCode}`);
  console.log(`   - Disabled response: ${JSON.stringify(mockResDisabled.body)}`);

  if (mockResDisabled.statusCode !== 403 || !mockResDisabled.body.error.includes('Disabled')) {
    throw new Error('Test 8 failed: Did not reject disabled status with 403.');
  }

  // Verify audit log
  const logDisabled = await db('license_logs').where({ license_id: finalLicId, action: 'machine_disabled' }).first();
  if (!logDisabled) {
    throw new Error('Test 8 failed: Missing machine_disabled log.');
  }
  console.log('✅ Test 8 Passed.');

  // Test 9: Obfuscated API responses in status payload
  console.log('\n▶️ Test 9: Verifying Hash Obfuscation in API Responses...');
  
  const statusRes = makeMockRes();
  await getActivationStatus({}, statusRes);

  console.log(`   - Status Response payload:`, JSON.stringify(statusRes.body, null, 2));

  if (!statusRes.body.machine_id || !statusRes.body.machine_id.includes('****')) {
    throw new Error('Test 9 failed: Full machine hash was exposed in getActivationStatus.');
  }
  console.log('✅ Test 9 Passed.');

  // Cleanup testing environment
  clearMockFingerprint();
  
  console.log('\n=====================================================');
  console.log('🎉 ALL PHASE 5 MACHINE BINDING TESTS PASSED SUCCESSFULLY!');
  console.log('=====================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILURE:', err);
  process.exit(1);
});

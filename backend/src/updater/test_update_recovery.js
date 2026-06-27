import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import assert from 'assert';
import { runSystemUpdate } from './updateManager.js';
import { isMaintenanceActive, disableMaintenance, enableMaintenance, maintenanceMiddleware } from './maintenanceMode.js';
import { clearRollbackFault, isRollbackFaultActive } from './rollbackManager.js';
import { loadJournal, clearJournal } from './transactionJournal.js';
import { validateCompatibility } from './migrationGate.js';
import { runtime } from '../config/runtimeConfig.js';
import { env } from '../config/env.js';
import { db } from '../db/connection.js';

const tempUpdatesDir = path.resolve('storage/updates');
const mockPatchFile = path.join(tempUpdatesDir, 'blde_update_patch_test.zip');

console.log('==============================================================================');
console.log('       BLDE EDC Safe Updater Sandbox (POC-5) Recovery Verification            ');
console.log('==============================================================================\n');

// Ensure parent updates folders
if (!fs.existsSync(tempUpdatesDir)) {
  fs.mkdirSync(tempUpdatesDir, { recursive: true });
}

// Clean previous locks
disableMaintenance();
clearRollbackFault();
clearJournal();

const createMockPatch = (content = 'MOCK_UPDATE_PAYLOAD') => {
  fs.writeFileSync(mockPatchFile, content, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
};

async function runRecoveryTests() {
  try {
    // ---------------------------------------------------------------------------
    // Simulation 1: Corrupted Checksum Rejection & Quarantine Isolation
    // ---------------------------------------------------------------------------
    console.log('🧪 Simulation 1: Evaluating corrupted checksum rejection and quarantine isolation...');
    const validHash = createMockPatch('REAL_DATA');
    const badHash = 'bad' + validHash.slice(3); // Altered hash signature
    
    try {
      await runSystemUpdate(mockPatchFile, badHash);
      assert.fail('Update should have been aborted on checksum mismatch');
    } catch (err) {
      assert.strictEqual(err.message, 'CHECKSUM_SIGNATURE_MISMATCH', 'Should reject signature mismatch');
      
      // Verify patch was quarantined successfully out of updates folder
      assert.ok(!fs.existsSync(mockPatchFile), 'Compromised patch should be deleted from active folder');
      const quarantinePath = path.join(runtime.storagePaths.updates, 'quarantine', 'blde_update_patch_test.zip');
      assert.ok(fs.existsSync(quarantinePath), 'Failed patch must reside inside quarantine isolation');
      
      // Cleanup quarantine file
      fs.unlinkSync(quarantinePath);
      console.log('   -> Pass: Corrupted signatures successfully quarantined.');
    }

    // ---------------------------------------------------------------------------
    // Simulation 2: Invalid Manifest Version Gap Rejection
    // ---------------------------------------------------------------------------
    console.log('\n🧪 Simulation 2: Evaluating compatibility gate manifest blocks...');
    const skippedManifest = {
      min_supported_version: '2.0.0', // Gap (current app is 1.0.0)
      target_version: '2.1.0'
    };
    const checkResult = validateCompatibility(skippedManifest);
    assert.strictEqual(checkResult.compatible, false, 'Compatibility gate should reject skipped version bounds');
    assert.strictEqual(checkResult.reason, 'UNSUPPORTED_VERSION_GAP', 'Should raise skipped version gap error');
    console.log('   -> Pass: Skipped version ranges rejected successfully.');

    // ---------------------------------------------------------------------------
    // Simulation 3: Maintenance Lock Mutating REST API blocks
    // ---------------------------------------------------------------------------
    console.log('\n🧪 Simulation 3: Evaluating Maintenance Mode Hard Locks...');
    
    // Engagement lock
    enableMaintenance();
    assert.ok(isMaintenanceActive(), 'Maintenance file lock should be active');

    // Mock Express Request objects
    let nextCalled = false;
    const mockReq = { method: 'POST', originalUrl: '/api/clinical/crf/insert' };
    const mockRes = {
      headers: {},
      set(key, val) { this.headers[key] = val; return this; },
      status(code) {
        assert.strictEqual(code, 503, 'Should return 503 Service Unavailable');
        return this;
      },
      json(payload) {
        assert.strictEqual(payload.status, 'maintenance', 'Response must return maintenance payload');
        assert.ok(payload.message, 'Response must include informative message');
      }
    };
    
    maintenanceMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });
    
    assert.ok(!nextCalled, 'Mutating request must be intercepted and NOT reach next handler');
    
    // Test safe login route bypassing
    let bypassCalled = false;
    const bypassReq = { method: 'POST', originalUrl: '/api/auth/login' };
    maintenanceMiddleware(bypassReq, mockRes, () => {
      bypassCalled = true;
    });
    assert.ok(bypassCalled, 'Safe auth routes must bypass maintenance blocks');
    
    disableMaintenance();
    console.log('   -> Pass: Mutating APIs blocked; safe login routes permitted.');

    // ---------------------------------------------------------------------------
    // Simulation 4: Failed Health-Check & Automatic Rollback
    // ---------------------------------------------------------------------------
    console.log('\n🧪 Simulation 4: Evaluating post-update health validator failure and rollbacks...');
    const hashSignature = createMockPatch('STAGED_MOCK_PAYLOAD');
    
    // We will execute a run that fails step 9 (Health check).
    // To mock a health check failure, let's set the environment variable.
    process.env.MOCK_HEALTH_CHECK_FAIL = 'true';

    try {
      await runSystemUpdate(mockPatchFile, hashSignature);
      assert.fail('Update should have rolled back due to disconnected database health check');
    } catch (err) {
      assert.ok(err.message.includes('Database connectivity lost') || err.message.includes('DATABASE_MIGRATION_FAILED') || err.message.includes('pool') || err.message.includes('Mock health check'), 'Should catch health db abort');
      
      // Assert that rollback fault update-block is active
      assert.ok(isRollbackFaultActive(), 'Unresolved Rollback Fault block must lock updates');
      
      // Assert that transaction journal was recorded
      const journal = loadJournal();
      assert.ok(journal.length > 0, 'Transaction journal checkpoints should persist');
      
      // Cleanup locks and restore DB pool connection
      clearRollbackFault();
      clearJournal();
      console.log('   -> Pass: Health check failures trigger automatic rollbacks and block further upgrades.');
    }

  } catch (e) {
    console.error('\n❌ UPDATER VERIFICATION CRASHED:', e.message);
    process.exit(1);
  } finally {
    delete process.env.MOCK_HEALTH_CHECK_FAIL;
    if (fs.existsSync(mockPatchFile)) {
      fs.unlinkSync(mockPatchFile);
    }
    // Restore dev environment database pools cleanly
    try {
      await db.raw('SELECT 1');
    } catch (_) {}

    console.log('\n==============================================================================');
    console.log('🎉 ALL SANDBOXED UPDATER & ROLLBACK SAFETY SIMULATIONS PASSED!');
    console.log('==============================================================================');
    process.exit(0);
  }
}

runRecoveryTests().catch(e => {
  console.error(e);
  process.exit(1);
});

import fs from 'fs';
import path from 'path';
import { verifyPackageChecksum } from './checksumVerifier.js';
import { validateCompatibility } from './migrationGate.js';
import { enableMaintenance, disableMaintenance } from './maintenanceMode.js';
import { createUpdateBackup } from './backupManager.js';
import { triggerRollback, isRollbackFaultActive } from './rollbackManager.js';
import { runUpdateHealthChecks } from './healthValidator.js';
import { extractToStaging, atomicSwapApp } from './stagingManager.js';
import { appendCheckpoint, clearJournal } from './transactionJournal.js';
import { db } from '../db/connection.js';
import { env } from '../config/env.js';

/**
 * Master update orchestration manager.
 * Guides the system sequentially through the GxP update workflow.
 */
export const runSystemUpdate = async (packagePath, expectedHash) => {
  console.log('🚀 [UPDATE MANAGER] Initiating safe system update sequence...');

  // Block updates if a previous rollback fault has not been resolved
  if (isRollbackFaultActive()) {
    console.error('❌ [UPDATE BLOCKED] System has an active unresolved Rollback Fault state.');
    console.error('   Resolution: Manual operator acknowledgement is required before running updates.');
    throw new Error('ROLLBACK_FAULT_STATE_ACTIVE');
  }

  let backupPath = null;

  try {
    // -------------------------------------------------------------------------
    // Step 1: Checksum Signature Verification
    // -------------------------------------------------------------------------
    const checksumOk = await verifyPackageChecksum(packagePath, expectedHash);
    if (!checksumOk) {
      throw new Error('CHECKSUM_SIGNATURE_MISMATCH');
    }
    appendCheckpoint('checksum_verified', true);

    // -------------------------------------------------------------------------
    // Step 2: Extraction Sandbox Staging
    // -------------------------------------------------------------------------
    const stageDir = extractToStaging(packagePath);
    appendCheckpoint('sandbox_staged', true);

    // -------------------------------------------------------------------------
    // Step 3: Migration Compatibility Checks
    // -------------------------------------------------------------------------
    const manifestPath = path.join(stageDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('UPDATE_MANIFEST_MISSING');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    const compatResult = validateCompatibility(manifest);
    if (!compatResult.compatible) {
      throw new Error(compatResult.reason);
    }
    appendCheckpoint('compatibility_gates_passed', true);

    // -------------------------------------------------------------------------
    // Step 4: Engagement of Maintenance Mode Lock
    // -------------------------------------------------------------------------
    enableMaintenance();
    appendCheckpoint('maintenance_locked', true);



    // -------------------------------------------------------------------------
    // Step 6: Create Snapshot Backup
    // -------------------------------------------------------------------------
    backupPath = await createUpdateBackup();
    appendCheckpoint('backup_created', true);

    // -------------------------------------------------------------------------
    // Step 7: Database Migration Run (Atomic Transaction)
    // -------------------------------------------------------------------------
    console.log('🔄 [UPDATE MANAGER] Initiating database schema migrations...');
    appendCheckpoint('migration_started', false);
    
    try {
      // In pilot, Knex migrates latest table schema updates dynamically
      await db.migrate.latest();
      appendCheckpoint('migration_started', true);
    } catch (migErr) {
      console.error(`❌ [MIGRATION FAULT] Schema upgrade aborted: ${migErr.message}`);
      throw new Error('DATABASE_MIGRATION_FAILED');
    }

    // -------------------------------------------------------------------------
    // Step 8: Atomic Staged App Swapping
    // -------------------------------------------------------------------------
    appendCheckpoint('atomic_swap_started', false);
    const mockActiveApp = path.join(path.resolve('storage/temp'), 'mock_active_app');
    const mockStagedApp = path.join(stageDir, 'app');
    
    // Ensure folders exist for swap simulation
    if (!fs.existsSync(mockActiveApp)) {
      fs.mkdirSync(mockActiveApp, { recursive: true });
    }
    
    atomicSwapApp(mockActiveApp, mockStagedApp);
    appendCheckpoint('atomic_swap_started', true);

    // -------------------------------------------------------------------------
    // Step 9: Post-Update Health Assertions
    // -------------------------------------------------------------------------
    appendCheckpoint('health_verification_started', false);
    await runUpdateHealthChecks();
    appendCheckpoint('health_verification_started', true);

    // -------------------------------------------------------------------------
    // Step 10: Conclude and Release Maintenance Lock
    // -------------------------------------------------------------------------
    disableMaintenance();
    clearJournal();
    
    console.log('🎉 [UPDATE COMPLETED] System upgraded successfully! Normal operations active.');
    return true;

  } catch (err) {
    console.error(`❌ [UPDATE COORDINATOR FAULT] System upgrade crashed: ${err.message}`);
    
    // -------------------------------------------------------------------------
    // Trigger Automatic Rollback Recovery instantly
    // -------------------------------------------------------------------------
    if (backupPath) {
      console.log('🚨 [EMERGENCY ACTION] Rolling back system to the last stable snapshot...');
      try {
        await triggerRollback(backupPath);
      } catch (rollbackErr) {
        console.error(`🔥 [DOUBLE FAULT] Rollback recovery also failed! ${rollbackErr.message}`);
      }
    }

    disableMaintenance();
    throw err;
  }
};

export default {
  runSystemUpdate
};

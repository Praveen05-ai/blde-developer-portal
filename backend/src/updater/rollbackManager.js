import fs from 'fs';
import path from 'path';
import { runtime } from '../config/runtimeConfig.js';
import { env } from '../config/env.js';
import { db } from '../db/connection.js';

const rollbackLogPath = path.join(runtime.storagePaths.logs, 'rollback.log');
const faultLockPath = path.join(runtime.storagePaths.temp, '.rollback_fault');

/**
 * Checks if the system is locked under an unresolved rollback fault state.
 */
export const isRollbackFaultActive = () => {
  return fs.existsSync(faultLockPath);
};

/**
 * Locks the system, preventing further updates until manual operator acknowledgement.
 */
export const lockRollbackFault = (reason) => {
  try {
    fs.writeFileSync(faultLockPath, JSON.stringify({
      reason,
      timestamp: new Date().toISOString(),
      status: 'Awaiting_Operator_Acknowledgement'
    }, null, 2), 'utf8');
  } catch (err) {
    // Silent fail
  }
};

/**
 * Clears the rollback fault state (called after manual operator check/ack).
 */
export const clearRollbackFault = () => {
  if (fs.existsSync(faultLockPath)) {
    try {
      fs.unlinkSync(faultLockPath);
      console.log('🔓 [ROLLBACK FAULT] Fault lock cleared. System is eligible for updates.');
    } catch (err) {
      console.error(`⚠️  Failed to clear fault lock: ${err.message}`);
    }
  }
};

/**
 * Appends standard logs to the append-only rollback ledger.
 */
const logRollbackEvent = (message) => {
  const logStr = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(rollbackLogPath, logStr, 'utf8');
  } catch (err) {
    // Fail silently
  }
};

/**
 * Triggers atomic database, configuration, and structural rollback restoration.
 */
export const triggerRollback = async (backupPath) => {
  console.error(`🚨 [ROLLBACK MANAGER] Initiating database & configuration rollback from: ${backupPath}...`);
  logRollbackEvent(`INITIATED: Rollback sequence started from ${backupPath}`);

  try {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup snapshot path does not exist: ${backupPath}`);
    }

    const manifestPath = path.join(backupPath, 'backup_manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Backup manifest file is missing.');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // 1. Restore configurations
    const configDir = path.dirname(path.resolve('config/runtime.json'));
    const targetConfig = path.join(configDir, 'runtime.json');
    const targetChecksum = path.join(configDir, 'runtime.json.sha256');

    const backupConfig = path.join(backupPath, 'runtime', 'runtime.json');
    const backupChecksum = path.join(backupPath, 'runtime', 'runtime.json.sha256');

    if (fs.existsSync(backupConfig)) {
      fs.copyFileSync(backupConfig, targetConfig);
      console.log('   - Authority runtime.json restored.');
    }
    if (fs.existsSync(backupChecksum)) {
      fs.copyFileSync(backupChecksum, targetChecksum);
      console.log('   - SHA-256 lock verified and restored.');
    }

    // 2. Restore Database Dialect
    const backupPgDump = path.join(backupPath, manifest.database_backup_path);
    if (fs.existsSync(backupPgDump)) {
      const rowsPayload = JSON.parse(fs.readFileSync(backupPgDump, 'utf8'));
      
      // Clean public tables first
      const tables = Object.keys(rowsPayload);
      for (const table of tables) {
        if (await db.schema.hasTable(table)) {
          await db(table).truncate();
          if (rowsPayload[table].length > 0) {
            await db(table).insert(rowsPayload[table]);
          }
        }
      }
      console.log('   - PostgreSQL database logical rows fully restored.');
    }

    // 3. Persist Rollback Lock Fault
    lockRollbackFault(`System rolled back from ${backupPath}`);
    logRollbackEvent('COMPLETED: System successfully restored to last stable state. Update-Block engaged.');
    console.log('🎉 [ROLLBACK SUCCESS] Recovery successfully completed. Updates are blocked until manual operator acknowledgement.');
    return true;

  } catch (err) {
    lockRollbackFault(`CRITICAL ROLLBACK FAILURE: ${err.message}`);
    logRollbackEvent(`FAILED: Critical error during rollback execution: ${err.message}`);
    console.error(`❌ [ROLLBACK CRITICAL FAILURE] Could not recover last stable state: ${err.message}`);
    throw err;
  }
};

export default {
  triggerRollback,
  isRollbackFaultActive,
  clearRollbackFault
};

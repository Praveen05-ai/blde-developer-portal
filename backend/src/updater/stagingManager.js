import fs from 'fs';
import path from 'path';
import { runtime } from '../config/runtimeConfig.js';

const stagingPath = path.join(runtime.storagePaths.temp, 'staging');

/**
 * Prepares staging directories cleanly.
 */
export const cleanStaging = () => {
  try {
    if (fs.existsSync(stagingPath)) {
      fs.rmSync(stagingPath, { recursive: true, force: true });
    }
    fs.mkdirSync(stagingPath, { recursive: true });
  } catch (err) {
    console.error(`⚠️  Failed to clean staging path: ${err.message}`);
  }
};

/**
 * Extracts and stages update packages into `/storage/temp/staging/`.
 * (Under pilot, handles logical copying and folder setups; prepared for actual zip/tar extractors).
 */
export const extractToStaging = (packagePath) => {
  console.log(`📦 [STAGING MANAGER] Staging update package: ${packagePath}...`);
  cleanStaging();

  try {
    // 1. Ensure staging subdirectories
    const appStage = path.join(stagingPath, 'app');
    const databaseStage = path.join(stagingPath, 'database_migrations');
    
    fs.mkdirSync(appStage, { recursive: true });
    fs.mkdirSync(databaseStage, { recursive: true });

    // Mock extraction of core patch files
    fs.writeFileSync(path.join(stagingPath, 'manifest.json'), JSON.stringify({
      min_supported_version: '1.0.0',
      target_version: '1.1.0'
    }, null, 2), 'utf8');

    // Create a mock migration file inside database_migrations
    fs.writeFileSync(
      path.join(databaseStage, '20260529202000_update_schema.js'),
      '// Mock Staged Migration File',
      'utf8'
    );

    console.log('   -> Success: Package staged cleanly in quarantine sandbox.');
    return stagingPath;

  } catch (err) {
    console.error(`❌ [STAGING FAILURE] Failed to stage update packages: ${err.message}`);
    throw err;
  }
};

/**
 * Performs atomic active binary swapping using operating system renames.
 */
export const atomicSwapApp = (activeAppPath, stagedAppPath) => {
  console.log(`🔄 [STAGING MANAGER] Swapping active directories atomically: ${activeAppPath} <- ${stagedAppPath}...`);
  
  if (!fs.existsSync(stagedAppPath)) {
    throw new Error('Staged app folder does not exist.');
  }

  const backupAppPath = path.join(runtime.storagePaths.temp, 'update_runtime_backup');
  if (fs.existsSync(backupAppPath)) {
    fs.rmSync(backupAppPath, { recursive: true, force: true });
  }

  try {
    // 1. Move active directory to temp backup folder
    if (fs.existsSync(activeAppPath)) {
      fs.renameSync(activeAppPath, backupAppPath);
    }

    // 2. Move staged directory to active folder atomically
    fs.renameSync(stagedAppPath, activeAppPath);
    
    console.log('   -> Success: Atomic swap completed.');
    return backupAppPath;

  } catch (err) {
    console.error(`❌ [ATOMIC SWAP FAULT] Active directory swap failed: ${err.message}`);
    
    // Recovery attempt: Restore backup if renaming failed mid-transaction
    if (fs.existsSync(backupAppPath) && !fs.existsSync(activeAppPath)) {
      fs.renameSync(backupAppPath, activeAppPath);
    }
    throw err;
  }
};

export default {
  extractToStaging,
  cleanStaging,
  atomicSwapApp
};

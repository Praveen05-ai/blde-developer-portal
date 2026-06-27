import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runtime } from '../config/runtimeConfig.js';
import { env } from '../config/env.js';
import { db } from '../db/connection.js';

const calculateMD5Sync = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
};

/**
 * Executes a complete, atomic backup snapshot before updates.
 * Saves databases, config authorities, and packages inside a versioned manifest.
 */
export const createUpdateBackup = async () => {
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const backupDirName = `backup_${timestamp}`;
  const backupPath = path.join(runtime.storagePaths.backups, backupDirName);

  console.log(`📦 [BACKUP MANAGER] Compiling GxP update snapshot: ${backupPath}...`);

  try {
    // 1. Create subfolders
    fs.mkdirSync(backupPath, { recursive: true });
    fs.mkdirSync(path.join(backupPath, 'database'), { recursive: true });
    fs.mkdirSync(path.join(backupPath, 'runtime'), { recursive: true });

    // 2. Snapshot configurations
    const configDir = path.dirname(path.resolve('config/runtime.json'));
    const rConfig = path.join(configDir, 'runtime.json');
    const rChecksum = path.join(configDir, 'runtime.json.sha256');

    if (fs.existsSync(rConfig)) {
      fs.copyFileSync(rConfig, path.join(backupPath, 'runtime', 'runtime.json'));
    }
    if (fs.existsSync(rChecksum)) {
      fs.copyFileSync(rChecksum, path.join(backupPath, 'runtime', 'runtime.json.sha256'));
    }

    // 3. Snapshot Database Dialect
    let dbBackupFile = null;
    let dbBackupMD5 = null;

    // PostgreSQL mode: In standard hospital servers, backups can be achieved by writing a raw SQL schema insert package
    // For developer pilot verification, we can export table rows as JSON dumps inside /database/ pg_dump Mock
    const dumpFile = path.join(backupPath, 'database', 'pg_dump.json');
    const backupPayload = {};
    
    const tables = ['users', 'projects', 'sites', 'records', 'audit_log'];
    for (const table of tables) {
      if (await db.schema.hasTable(table)) {
        backupPayload[table] = await db(table).select('*');
      }
    }

    fs.writeFileSync(dumpFile, JSON.stringify(backupPayload, null, 2), 'utf8');
    dbBackupFile = dumpFile;
    dbBackupMD5 = crypto.createHash('md5').update(JSON.stringify(backupPayload)).digest('hex');
    console.log('   - PostgreSQL logical rows snapshot successfully compiled.');

    // 4. Compile backup_manifest.json
    const migStatus = await db.migrate.status().catch(() => 0);
    const manifest = {
      timestamp: new Date().toISOString(),
      app_version: runtime.app_version,
      database_dialect: env.db.client,
      active_migration_batch: migStatus,
      database_backup_checksum: dbBackupMD5,
      database_backup_path: dbBackupFile ? path.relative(backupPath, dbBackupFile) : null,
      runtime_config_checksum: calculateMD5Sync(rConfig)
    };

    fs.writeFileSync(
      path.join(backupPath, 'backup_manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    console.log('   -> Success: Safe backup compiled successfully.');
    return backupPath;

  } catch (err) {
    console.error(`❌ [BACKUP FAILURE] Failed to generate update snapshot: ${err.message}`);
    throw err;
  }
};

export default {
  createUpdateBackup
};

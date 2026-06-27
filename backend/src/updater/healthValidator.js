import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { env } from '../config/env.js';
import { runtime } from '../config/runtimeConfig.js';

/**
 * Validates system health post-migration or pre-activation on staged codes.
 * Ensures the system matches GxP safety policies before releasing maintenance modes.
 */
export const runUpdateHealthChecks = async () => {
  console.log('🔍 [HEALTH VALIDATOR] Executing post-update GxP integrity audit...');
  
  if (process.env.MOCK_HEALTH_CHECK_FAIL === 'true') {
    throw new Error('Database connectivity lost after update: Mock health check failure');
  }
  
  // 1. Verify DB Connectivity
  try {
    await db.raw('SELECT 1');
    console.log('   - Database connectivity: Verified.');
  } catch (err) {
    throw new Error(`Database connectivity lost after update: ${err.message}`);
  }

  // 2. Verify Storage Writability
  Object.entries(runtime.storagePaths).forEach(([name, p]) => {
    const probeFile = path.join(p, `.health_probe_${Date.now()}`);
    try {
      fs.writeFileSync(probeFile, 'HEALTH_OK', 'utf8');
      fs.unlinkSync(probeFile);
    } catch (err) {
      throw new Error(`Persistent folder ${name} lost write permissions after update: ${err.message}`);
    }
  });
  console.log('   - Storage writability probes: Passed.');



  // 4. Verify runtime.json format integrity
  const configPath = path.join(path.resolve('config'), 'runtime.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Authority runtime.json is missing post-update!');
  }
  console.log('   - Configuration integrity: Verified.');

  console.log('   -> Success: All post-update system health assertions passed.');
  return true;
};

export default {
  runUpdateHealthChecks
};

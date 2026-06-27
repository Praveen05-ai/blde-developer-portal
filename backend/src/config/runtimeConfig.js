import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import net from 'net';
import { execSync } from 'child_process';

// 1. Dynamic upward traversal to find config/runtime.json in workspace root
const findRuntimeConfig = () => {
  let currentDir = path.resolve(process.cwd());
  while (true) {
    const configPath = path.join(currentDir, 'config', 'runtime.json');
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  return null;
};

const configPath = findRuntimeConfig();
if (!configPath) {
  console.error('\x1b[31m❌ CRITICAL ARCHITECTURAL FAULT: Centralized runtime.json config not found!\x1b[0m');
  console.error('Please ensure /config/runtime.json is present in the workspace root.\n');
  process.exit(1);
}

// 2. Read runtime config and verify integrity
let rawData = '';
let runtimeConfig = {};
try {
  rawData = fs.readFileSync(configPath, 'utf8');
  runtimeConfig = JSON.parse(rawData);
} catch (err) {
  console.error('\x1b[31m❌ CRITICAL CONFIGURATION FAILURE: runtime.json is corrupted or invalid JSON!\x1b[0m');
  console.error(err.message);
  process.exit(1);
}

// 3. SHA-256 Checksum Lock Verification (POC-1 Checksum Validation)
const checksumPath = path.join(path.dirname(configPath), 'runtime.json.sha256');
const calculatedChecksum = crypto.createHash('sha256').update(rawData, 'utf8').digest('hex');

if (fs.existsSync(checksumPath)) {
  const lockedChecksum = fs.readFileSync(checksumPath, 'utf8').trim();
  if (calculatedChecksum !== lockedChecksum) {
    console.error('\x1b[31m❌ CRITICAL CONFIGURATION FAILURE: CONFIG TAMPER DETECTED!\x1b[0m');
    console.error(`   The SHA-256 checksum of runtime.json does not match the locked manifest record.`);
    console.error(`   Locked Checksum:     ${lockedChecksum}`);
    console.error(`   Calculated Checksum: ${calculatedChecksum}`);
    console.error(`   Why this matters: GxP guidelines prohibit unauthorized or corrupted runtime modifications.`);
    console.error(`   Resolution: Restore runtime.json or regenerate the .sha256 lock if authorized.`);
    process.exit(1);
  }
} else {
  // Self-healing: Lock the current configuration state automatically
  try {
    fs.writeFileSync(checksumPath, calculatedChecksum, 'utf8');
    console.log(`\x1b[33m⚠️  [INTEGRITY LOCK] Locked runtime.json SHA-256 checksum: ${calculatedChecksum}\x1b[0m`);
  } catch (err) {
    console.warn(`⚠️  Failed to generate checksum lock file: ${err.message}`);
  }
}

// 4. Strict Schema Validation (POC-1 Schema Validation)
const validateSchema = (config) => {
  const requiredKeys = [
    'deployment_profile',
    'database_mode',
    'backend_mode',
    'port',
    'storage_root',
    'updates_mode',
    'app_version',
    'migration_version',
    'features'
  ];

  const missingKeys = [];
  for (const key of requiredKeys) {
    if (config[key] === undefined) {
      missingKeys.push(key);
    }
  }

  if (missingKeys.length > 0) {
    console.error('\x1b[31m❌ CRITICAL RUNTIME CONFIG SCHEMATIC DEVIATION: Missing required configuration keys:\x1b[0m');
    missingKeys.forEach(k => console.error(`   - ${k}`));
    process.exit(1);
  }

  // Type & Value Validations
  const profiles = ['single_user_laptop', 'university', 'lab', 'saas'];
  if (!profiles.includes(config.deployment_profile)) {
    console.error(`❌ INVALID CONFIGURATION: "deployment_profile" must be one of: ${profiles.join(', ')}`);
    process.exit(1);
  }

  const dbModes = ['pg'];
  if (!dbModes.includes(config.database_mode)) {
    console.error(`❌ INVALID CONFIGURATION: "database_mode" must be "pg" (PostgreSQL) for institutional servers.`);
    process.exit(1);
  }

  const backendModes = ['native', 'docker'];
  if (!backendModes.includes(config.backend_mode)) {
    console.error(`❌ INVALID CONFIGURATION: "backend_mode" must be one of: ${backendModes.join(', ')}`);
    process.exit(1);
  }

  if (typeof config.port !== 'number' || config.port < 1024 || config.port > 65535) {
    console.error(`❌ INVALID CONFIGURATION: "port" must be a valid number between 1024 and 65535.`);
    process.exit(1);
  }

  if (typeof config.storage_root !== 'string' || config.storage_root.trim() === '') {
    console.error(`❌ INVALID CONFIGURATION: "storage_root" must be a non-empty string.`);
    process.exit(1);
  }

  const updateModes = ['offline', 'online'];
  if (!updateModes.includes(config.updates_mode)) {
    console.error(`❌ INVALID CONFIGURATION: "updates_mode" must be one of: ${updateModes.join(', ')}`);
    process.exit(1);
  }

  if (typeof config.app_version !== 'string' || !/^\d+\.\d+\.\d+/.test(config.app_version)) {
    console.error(`❌ INVALID CONFIGURATION: "app_version" must be a valid SemVer string (e.g. 1.0.0).`);
    process.exit(1);
  }

  if (typeof config.features !== 'object' || typeof config.features.enable_ai !== 'boolean' || typeof config.features.enable_orthanc !== 'boolean') {
    console.error(`❌ INVALID CONFIGURATION: "features" must be an object with boolean flags: "enable_ai" and "enable_orthanc".`);
    process.exit(1);
  }
};

validateSchema(runtimeConfig);

// 5. Resolve Storage Paths Authoritatively
const workspaceRoot = path.resolve(path.dirname(configPath), '..');
const storageRoot = path.resolve(workspaceRoot, runtimeConfig.storage_root);

export const storagePaths = {
  root: storageRoot,
  database: path.join(storageRoot, 'database'),
  uploads: path.join(storageRoot, 'uploads'),
  backups: path.join(storageRoot, 'backups'),
  logs: path.join(storageRoot, 'logs'),
  cache: path.join(storageRoot, 'cache'),
  temp: path.join(storageRoot, 'temp'),
  updates: path.join(storageRoot, 'updates')
};

// 6. Self-healing: Create folders and execute Writability Probes
Object.entries(storagePaths).forEach(([name, p]) => {
  if (!fs.existsSync(p)) {
    try {
      fs.mkdirSync(p, { recursive: true });
      console.log(`✨ [SELF-HEALED] Storage directory created: ${p}`);
    } catch (err) {
      console.error(`\x1b[31m❌ CRITICAL STORAGE PATH CREATION FAILURE: Could not create directory for ${name} at ${p}\x1b[0m`);
      console.error(err.message);
      process.exit(1);
    }
  }

  // Writability probe
  const probeFile = path.join(p, `.write_probe_${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.writeFileSync(probeFile, 'BLDE_EDC_PROBE', 'utf8');
    fs.unlinkSync(probeFile);
  } catch (err) {
    console.error(`\x1b[31m❌ CRITICAL PERSISTENT PATH IS READ-ONLY: Directory for ${name} at ${p} has permission restrictions!\x1b[0m`);
    console.error(`   Error details: ${err.message}`);
    console.error(`   GxP Compliance Impact: Clinical case files, audit trails, and logs require active write permissions.`);
    console.error(`   Resolution: Adjust operating system folders security access configurations and restart.`);
    process.exit(1);
  }
});

// 7. Dynamic Port Probing (POC-1 Dynamic Port Probing Logic)
export const verifyPortAvailability = (port, host = '127.0.0.1') => {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\x1b[31m❌ PORT COLLISION BLOCKED STARTUP: Port ${port} is in use!\x1b[0m`);
        console.error(`   Host Binding: ${host}:${port}`);
        console.error(`   Why this matters: The Express backend server cannot start while this port is locked.`);
        
        // Dynamic diagnostics to find the process/service occupying the port (Windows systems)
        if (process.platform === 'win32') {
          try {
            // Find PID using netstat
            const netstatOutput = execSync(`netstat -ano`).toString();
            const lines = netstatOutput.split('\n');
            const targetPattern = new RegExp(`:${port}\\s+.*\\s+LISTENING\\s+(\\d+)`, 'i');
            let foundPid = null;
            
            for (const line of lines) {
              const match = line.match(targetPattern);
              if (match) {
                foundPid = match[1];
                break;
              }
            }

            if (foundPid) {
              console.error(`   Conflicting Process Details:`);
              console.error(`     - PID: ${foundPid}`);
              try {
                const tasklistOutput = execSync(`tasklist /fi "pid eq ${foundPid}" /fo csv /nh`).toString();
                const parts = tasklistOutput.trim().split(',');
                if (parts.length > 0) {
                  const processName = parts[0].replace(/"/g, '');
                  console.error(`     - Process Name: ${processName}`);
                }
              } catch (e) {
                // Ignore tasklist fetch failure
              }
            } else {
              console.error(`   Conflicting Process: PID could not be determined from netstat.`);
            }
          } catch (execErr) {
            console.error(`   Could not automatically query netstat processes: ${execErr.message}`);
          }
        }
        
        console.error(`\x1b[33m   Resolution Guide:`);
        console.error(`     1. Identify and stop the conflicting background service.`);
        console.error(`     2. Modify the port dynamically inside "/config/runtime.json" (e.g. "port": 3002).`);
        console.error(`     3. Clean the port checksum file if changes are manually authorized.`);
        console.error(`     4. Restart the installer or native background service.\x1b[0m\n`);
        
        process.exit(1);
      } else {
        reject(err);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve();
      });
    });

    server.listen(port, host);
  });
};

export const runtime = {
  ...runtimeConfig,
  storagePaths
};

export default runtime;

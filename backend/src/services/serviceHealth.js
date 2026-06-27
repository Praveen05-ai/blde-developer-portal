import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { runtime } from '../config/runtimeConfig.js';

const healthFilePath = path.join(runtime.storagePaths.temp, 'service_health.json');
const serviceLogPath = path.join(runtime.storagePaths.logs, 'service.log');

// Helper to write to service.log
const logHeartbeat = (message) => {
  const logStr = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(serviceLogPath, logStr, 'utf8');
  } catch (err) {
    // Fail silently to prevent throwing during log lock conflicts
  }
};

// 1. Core Persistent Health Telemetry Tracking
let healthStats = {
  restarts: 0,
  first_boot: new Date().toISOString(),
  last_heartbeat: new Date().toISOString()
};

try {
  if (fs.existsSync(healthFilePath)) {
    const rawData = fs.readFileSync(healthFilePath, 'utf8');
    healthStats = { ...healthStats, ...JSON.parse(rawData) };
  }
  // Increment restart counter (self-healing reboot/crash log)
  healthStats.restarts += 1;
  healthStats.last_heartbeat = new Date().toISOString();
  fs.writeFileSync(healthFilePath, JSON.stringify(healthStats, null, 2), 'utf8');
  
  logHeartbeat(`⚙️  [SERVICE BOOT] Process initialized (PID: ${process.pid}). Restart count: ${healthStats.restarts}`);
} catch (err) {
  logHeartbeat(`⚠️  [SERVICE BOOT] Failed to process health stats file: ${err.message}`);
}

// 2. Dynamic Heartbeat Telemetry Probes
export const startHealthMonitoring = () => {
  // Execute checks every 10 seconds
  const intervalId = setInterval(() => {
    try {
      const memory = process.memoryUsage();
      const memRssMB = (memory.rss / 1024 / 1024).toFixed(2);
      const memHeapMB = (memory.heapUsed / 1024 / 1024).toFixed(2);

      const storageStats = 'PostgreSQL active (server mode)';

      // Output unified heartbeats logs
      logHeartbeat(
        `💓 [HEARTBEAT] PID: ${process.pid} | Memory RSS: ${memRssMB}MB (Heap: ${memHeapMB}MB) | Database Size: ${storageStats} | Restarts: ${healthStats.restarts}`
      );

      // Save latest heartbeat timestamp
      healthStats.last_heartbeat = new Date().toISOString();
      fs.writeFileSync(healthFilePath, JSON.stringify(healthStats, null, 2), 'utf8');

    } catch (heartbeatErr) {
      logHeartbeat(`⚠️  [HEARTBEAT EXCEPTION] Failed to execute checks: ${heartbeatErr.message}`);
    }
  }, 10000);

  // Allow process to exit cleanly by unreferencing the timer
  intervalId.unref();
};

export default {
  startHealthMonitoring
};

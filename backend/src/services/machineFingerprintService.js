import { execSync } from 'child_process';
import os from 'os';
import crypto from 'crypto';

let cachedFingerprint = null;

export function setMockFingerprint(mock) {
  cachedFingerprint = mock;
}

export function clearMockFingerprint() {
  cachedFingerprint = null;
}

function runPowerShell(cmd) {
  try {
    return execSync(`powershell -Command "${cmd}"`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    return null;
  }
}

function runWmic(cmd) {
  try {
    return execSync(`cmd /c "${cmd}"`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    return null;
  }
}

export function getMachineFingerprint() {
  if (cachedFingerprint) {
    return cachedFingerprint;
  }

  let cpuId = '';
  let motherboard = '';
  let diskSerial = '';

  if (process.platform === 'win32') {
    // 1. CPU ID via CIM
    cpuId = runPowerShell('Get-CimInstance Win32_Processor | Select-Object -ExpandProperty ProcessorId');
    if (!cpuId || cpuId.startsWith('ERROR')) {
      const wmicCpu = runWmic('wmic cpu get processorid');
      cpuId = wmicCpu ? wmicCpu.replace('ProcessorId', '').trim() : '';
    }

    // 2. Motherboard Serial via CIM
    motherboard = runPowerShell('Get-CimInstance Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber');
    if (!motherboard || motherboard.startsWith('ERROR')) {
      const wmicBoard = runWmic('wmic baseboard get serialnumber');
      motherboard = wmicBoard ? wmicBoard.replace('SerialNumber', '').trim() : '';
    }

    // 3. Disk Serial via CIM
    diskSerial = runPowerShell('Get-CimInstance Win32_DiskDrive | Select-Object -ExpandProperty SerialNumber');
    if (!diskSerial || diskSerial.startsWith('ERROR')) {
      const wmicDisk = runWmic('wmic diskdrive get serialnumber');
      diskSerial = wmicDisk ? wmicDisk.replace('SerialNumber', '').trim() : '';
    }
  } else {
    cpuId = 'NON_WIN_CPU';
    motherboard = 'NON_WIN_BOARD';
    diskSerial = 'NON_WIN_DISK';
  }

  // Fallbacks for any empty values
  cpuId = cpuId || 'UNKNOWN_CPU';
  motherboard = motherboard || 'UNKNOWN_BOARD';
  diskSerial = diskSerial || 'UNKNOWN_DISK';

  // Clean whitespace/newlines
  cpuId = cpuId.replace(/\s+/g, ' ').trim();
  motherboard = motherboard.replace(/\s+/g, ' ').trim();
  diskSerial = diskSerial.replace(/\s+/g, ' ').trim();

  // OS & Hostname
  const hostname = os.hostname() || 'UNKNOWN_HOST';
  const osInfo = `${os.type() || ''} ${os.platform() || ''} ${os.release() || ''}`.trim();

  // MAC Address
  const interfaces = os.networkInterfaces();
  const macsList = [];
  for (const name of Object.keys(interfaces)) {
    for (const netInterface of interfaces[name]) {
      if (!netInterface.internal && netInterface.mac && netInterface.mac !== '00:00:00:00:00:00') {
        macsList.push(netInterface.mac);
      }
    }
  }
  const macs = macsList.sort().join(',');

  // Concatenate and Hash via SHA-256
  const rawString = `${cpuId}|${motherboard}|${diskSerial}|${macs}|${hostname}|${osInfo}`;
  const machine_hash = crypto.createHash('sha256').update(rawString, 'utf8').digest('hex');

  cachedFingerprint = {
    machine_hash,
    fingerprint_version: 'v1',
    machine_name: hostname
  };

  return cachedFingerprint;
}

export function obfuscateHash(hash) {
  if (!hash || typeof hash !== 'string' || hash.length < 8) {
    return 'N/A';
  }
  return `${hash.substring(0, 4)}****${hash.substring(hash.length - 3)}`;
}

export function safeCompare(str1, str2) {
  if (typeof str1 !== 'string' || typeof str2 !== 'string') return false;
  const buf1 = Buffer.from(str1, 'utf8');
  const buf2 = Buffer.from(str2, 'utf8');
  if (buf1.length !== buf2.length) return false;
  return crypto.timingSafeEqual(buf1, buf2);
}

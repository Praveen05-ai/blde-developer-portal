import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runtime } from '../config/runtimeConfig.js';

/**
 * Calculates SHA-256 checksum of a file.
 */
export const calculateFileHash = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
};

/**
 * Safe update quarantine mechanism.
 * Relocates corrupted or untrusted patches safely away from executable folders.
 */
export const quarantinePackage = (filePath) => {
  try {
    const filename = path.basename(filePath);
    const quarantinePath = path.join(runtime.storagePaths.updates, 'quarantine', filename);
    
    // Ensure quarantine folder exists
    const qDir = path.dirname(quarantinePath);
    if (!fs.existsSync(qDir)) {
      fs.mkdirSync(qDir, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, quarantinePath);
      console.warn(`🚨 [QUARANTINE SAFETY] Package relocated successfully: ${quarantinePath}`);
    }
    return quarantinePath;
  } catch (err) {
    console.error(`❌ [QUARANTINE FAILURE] Could not isolate compromised package: ${err.message}`);
    // If rename failed, try deleting to guarantee safety
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    return null;
  }
};

/**
 * Validates the update package SHA-256 signature.
 * Pluggable support is structured for detached GPG or Ed25519 signatures later.
 */
export const verifyPackageChecksum = async (packagePath, expectedHash) => {
  console.log(`🔍 [CHECKSUM VERIFIER] Probing package signature: ${packagePath}`);
  
  if (!fs.existsSync(packagePath)) {
    throw new Error('Update patch file does not exist.');
  }

  const fileHash = await calculateFileHash(packagePath);
  
  if (fileHash !== expectedHash.trim().toLowerCase()) {
    console.error(`❌ [SIGNATURE MISMATCH] Calculated hash: ${fileHash} vs Expected: ${expectedHash}`);
    quarantinePackage(packagePath);
    return false;
  }

  console.log('   -> Success: Package checksum matches. Release verification approved.');
  return true;
};

export default {
  verifyPackageChecksum,
  quarantinePackage,
  calculateFileHash
};

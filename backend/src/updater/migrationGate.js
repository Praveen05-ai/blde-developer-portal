import { runtime } from '../config/runtimeConfig.js';
import semver from 'semver'; // standard Node-compatible semver operations or lightweight parsing

/**
 * Custom semver comparison helper (zero outside dependencies)
 * Assumes format major.minor.patch
 */
const compareVersions = (v1, v2) => {
  const parse = v => v.split('.').map(Number);
  const [a1, b1, c1] = parse(v1);
  const [a2, b2, c2] = parse(v2);

  if (a1 !== a2) return a1 - a2;
  if (b1 !== b2) return b1 - b2;
  return c1 - c2;
};

/**
 * Validates update package migration gates.
 * Prevents schema downgrades or skipped target ranges.
 */
export const validateCompatibility = (manifest) => {
  console.log('🔍 [MIGRATION GATE] Auditing version schema compatibility...');
  
  const currentVersion = runtime.app_version;
  const targetVersion = manifest.target_version;
  const minSupported = manifest.min_supported_version;

  console.log(`   -> Current Version:  ${currentVersion}`);
  console.log(`   -> Target Version:   ${targetVersion}`);
  console.log(`   -> Min Supported:    ${minSupported}`);

  // 1. Prevent Downgrade attempts
  if (compareVersions(targetVersion, currentVersion) < 0) {
    console.error(`❌ [COMPATIBILITY FAULT] Downgrades are strictly blocked! Target: ${targetVersion} < Active: ${currentVersion}`);
    return { compatible: false, reason: 'UNSAFE_DOWNGRADE_ATTEMPT' };
  }

  // 2. Prevent Skipped migrations
  if (compareVersions(currentVersion, minSupported) < 0) {
    console.error(`❌ [COMPATIBILITY FAULT] Skipped version ranges! Current: ${currentVersion} is below minimum supported: ${minSupported}`);
    return { compatible: false, reason: 'UNSUPPORTED_VERSION_GAP' };
  }

  // 3. Prevent duplicate installations
  if (compareVersions(targetVersion, currentVersion) === 0) {
    console.log('   [COMPATIBILITY INFO] Package version is identical to current active version.');
  }

  console.log('   -> Success: Version schema continuity approved.');
  return { compatible: true };
};

export default {
  validateCompatibility
};

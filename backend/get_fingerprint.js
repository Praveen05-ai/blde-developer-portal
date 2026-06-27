import { getMachineFingerprint } from './src/services/machineFingerprintService.js';

try {
  const fp = getMachineFingerprint();
  console.log('=== Machine Hardware Fingerprint ===');
  console.log('JSON Signature:\n', JSON.stringify(fp, null, 2));
  console.log('\nHardware Hash to Paste Manually:\n', fp.machine_hash);
} catch (err) {
  console.error('Failed to generate fingerprint:', err.message);
}

import { encryptPackage, decryptPackage } from './crypto.js';
import assert from 'assert';

console.log('🧪 Starting Cryptography Utility Verification...');

try {
  const originalData = {
    package_type: 'project_setup',
    schema_version: 20260601,
    project: { title: 'Neonatal Cry Study 2026' },
    instruments: [{ id: 1, name: 'Vitals Form' }]
  };

  // 1. Assert Encryption
  const encrypted = encryptPackage(originalData);
  assert.ok(encrypted, 'Encryption should output a Base64 string');
  console.log('✅ Encrypted Base64 package compiled: ', encrypted.slice(0, 50) + '...');

  // 2. Assert Decryption
  const decrypted = decryptPackage(encrypted);
  assert.deepStrictEqual(decrypted, originalData, 'Decrypted data should match original');
  console.log('✅ Decryption verified successfully: ', decrypted.project.title);

  // 3. Assert Tamper Detection
  const modifiedBytes = Buffer.from(encrypted, 'base64');
  // Mutate one byte in the ciphertext payload
  modifiedBytes[20] = modifiedBytes[20] ^ 1;
  const tamperedPackage = modifiedBytes.toString('base64');

  try {
    decryptPackage(tamperedPackage);
    assert.fail('Tampered package should have thrown an error');
  } catch (error) {
    assert.ok(error.message.includes('signature verification failed') || error.message.includes('Decryption failed'), 'Should throw signature validation exception');
    console.log('✅ Tamper validation detected and blocked tampered package successfully: ', error.message);
  }

  console.log('\n⭐ CRYPTO VERIFICATION COMPLETED SUCCESSFULLY!');
} catch (error) {
  console.error('❌ CRYPTO VERIFICATION FAILED: ', error);
  process.exit(1);
}

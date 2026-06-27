import crypto from 'crypto';

// Use a dedicated static platform-wide key to ensure package portability between different installations
const secretKey = 'blde_platform_package_system_key_2026_sealer';
const ENCRYPTION_KEY = crypto.scryptSync(secretKey, 'blde_salt_enc', 32);
const SIGNING_KEY = crypto.scryptSync(secretKey, 'blde_salt_sign', 32);

/**
 * Encrypts a clinical configuration JSON object using AES-256-GCM and signs it with HMAC-SHA256.
 * @param {object} dataObj - The configuration object to encrypt.
 * @returns {string} Base64-encoded encrypted package string.
 */
export const encryptPackage = (dataObj) => {
  try {
    const jsonStr = JSON.stringify(dataObj);
    const iv = crypto.randomBytes(12); // Recommended 12 bytes IV for AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    
    let ciphertext = cipher.update(jsonStr, 'utf8');
    ciphertext = Buffer.concat([ciphertext, cipher.final()]);
    
    const authTag = cipher.getAuthTag(); // 16-byte authentication tag
    
    // Payload Buffer = IV (12 bytes) + AuthTag (16 bytes) + Ciphertext
    const payload = Buffer.concat([iv, authTag, ciphertext]);
    
    // Calculate HMAC-SHA256 signature over payload
    const hmac = crypto.createHmac('sha256', SIGNING_KEY).update(payload).digest();
    
    // Final Package = Payload + HMAC (32 bytes)
    const finalBuffer = Buffer.concat([payload, hmac]);
    return finalBuffer.toString('base64');
  } catch (error) {
    throw new Error('Encryption failed: ' + error.message);
  }
};

/**
 * Verifies the HMAC signature and decrypts the package using AES-256-GCM.
 * @param {string} base64Str - The Base64 encrypted package string.
 * @returns {object} The decrypted configuration object.
 */
export const decryptPackage = (base64Str) => {
  try {
    const buffer = Buffer.from(base64Str, 'base64');
    if (buffer.length < 12 + 16 + 32) {
      throw new Error('Package is truncated or invalid');
    }
    
    // Split payload and hmac
    const payload = buffer.slice(0, buffer.length - 32);
    const receivedHmac = buffer.slice(buffer.length - 32);
    
    // Verify signature using timing-safe comparison
    const expectedHmac = crypto.createHmac('sha256', SIGNING_KEY).update(payload).digest();
    if (!crypto.timingSafeEqual(receivedHmac, expectedHmac)) {
      throw new Error('Tamper detected: package signature verification failed');
    }
    
    // Split IV, AuthTag, and Ciphertext
    const iv = payload.slice(0, 12);
    const authTag = payload.slice(12, 28);
    const ciphertext = payload.slice(28);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(ciphertext, 'binary', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error) {
    throw new Error('Decryption failed: ' + error.message);
  }
};

export default {
  encryptPackage,
  decryptPackage
};

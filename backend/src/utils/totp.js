import crypto from 'crypto';

// Pure JavaScript Base32 Decoder (RFC 4648 compatible)
// Eliminates dependence on external C++ native binary packages
export function decodeBase32(base32String) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanString = base32String.toUpperCase().replace(/=+$/, '');
  let length = cleanString.length;
  const bits = [];
  
  for (let i = 0; i < length; i++) {
    const val = alphabet.indexOf(cleanString[i]);
    if (val === -1) {
      throw new Error(`Invalid base32 character: ${cleanString[i]}`);
    }
    // Push 5 bits
    for (let shift = 4; shift >= 0; shift--) {
      bits.push((val >> shift) & 1);
    }
  }

  // Group into 8-bit bytes
  const bytes = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let byteVal = 0;
    for (let shift = 7; shift >= 0; shift--) {
      byteVal |= bits[i + (7 - shift)] << shift;
    }
    bytes.push(byteVal);
  }

  return Buffer.from(bytes);
}

// Generate base32 secret
export function getTOTPSecret() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// Verify TOTP token with +/- 1 time-step (30 seconds window) tolerance
export function verifyTOTP(secret, code) {
  try {
    const key = decodeBase32(secret);
    const codeStr = String(code).trim();
    
    if (codeStr.length !== 6 || isNaN(codeStr)) {
      return false;
    }

    const timeWindow = 30000; // 30 seconds
    const now = Date.now();

    for (let d = -1; d <= 1; d++) {
      const counter = Math.floor(now / timeWindow) + d;
      
      // Buffer of 8 bytes for counter
      const buf = Buffer.alloc(8);
      // Write 64-bit integer
      buf.writeBigInt64BE(BigInt(counter));

      // Calculate HMAC-SHA1
      const hmac = crypto.createHmac('sha1', key).update(buf).digest();
      
      // Dynamic truncation
      const offset = hmac[hmac.length - 1] & 0xf;
      const expected = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
      
      if (String(expected).padStart(6, '0') === codeStr) {
        return true;
      }
    }
  } catch (error) {
    return false;
  }
  
  return false;
}

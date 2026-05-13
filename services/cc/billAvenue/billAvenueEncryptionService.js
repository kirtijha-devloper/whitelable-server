const forge = require('node-forge');
const billAvenueConfig = require('../../../config/billavenue');

/**
 * BillAvenue AES-128-CBC encryption — matches the reference PHP implementation:
 *   Key = hextobin(md5(apiKey))  → raw 16-byte MD5 digest
 *   IV  = pack("C*", 0x00..0x0f) → bytes 0x00–0x0f
 *   Encrypt output : hex string  (PHP bin2hex)
 *   Decrypt input  : hex string  (PHP hextobin)
 */

// BillAvenue-provided fixed IV for the biller-info / biller-list flow.
// IV = 0x00 0x01 0x02 0x03 0x04 0x05 0x06 0x07 0x08 0x09 0x0a 0x0b 0x0c 0x0d 0x0e 0x0f
const IV = String.fromCharCode(
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
);

function getKey() {
  // hextobin(md5(apiKey)) — raw binary MD5 digest (16 bytes)
  const md = forge.md.md5.create();
  md.update(billAvenueConfig.apiKey, 'utf8');
  return md.digest().getBytes();
}

/**
 * Encrypt plaintext (XML) → hex ciphertext.
 */
function encrypt(plainText) {
  const key = getKey();
  const cipher = forge.cipher.createCipher('AES-CBC', key);
  cipher.start({ iv: IV });
  cipher.update(forge.util.createBuffer(plainText, 'utf8'));
  cipher.finish();
  return forge.util.bytesToHex(cipher.output.getBytes());
}

/**
 * Decrypt hex ciphertext → plaintext (XML).
 */
function decryptHex(encryptedHex) {
  const clean = String(encryptedHex).trim();
  const key = getKey();
  const encryptedBytes = forge.util.hexToBytes(clean);
  const decipher = forge.cipher.createDecipher('AES-CBC', key);
  decipher.start({ iv: IV });
  decipher.update(forge.util.createBuffer(encryptedBytes));
  const ok = decipher.finish();
  if (!ok) throw new Error('AES-hex decryption failed');
  return decipher.output.toString('utf8');
}

/**
 * Decrypt base64 ciphertext → plaintext (XML).
 */
function decryptBase64(encryptedBase64) {
  const clean = String(encryptedBase64).trim();
  const key = getKey();
  const encryptedBytes = forge.util.decode64(clean);
  const decipher = forge.cipher.createDecipher('AES-CBC', key);
  decipher.start({ iv: IV });
  decipher.update(forge.util.createBuffer(encryptedBytes));
  const ok = decipher.finish();
  if (!ok) throw new Error('AES-base64 decryption failed');
  return decipher.output.toString('utf8');
}

/**
 * Smart decrypt: try hex first, then base64.
 */
function decrypt(ciphertext) {
  const clean = String(ciphertext).trim();

  // If it looks like valid hex (even-length, only 0-9a-fA-F), try hex first
  if (/^[0-9a-fA-F]+$/.test(clean) && clean.length % 2 === 0) {
    try {
      return decryptHex(clean);
    } catch (_) { /* fall through to base64 */ }
  }

  // Try base64
  try {
    return decryptBase64(clean);
  } catch (_) { /* fall through */ }

  throw new Error('AES decryption failed — could not decrypt as hex or base64');
}

module.exports = { encrypt, decrypt, decryptHex, decryptBase64 };

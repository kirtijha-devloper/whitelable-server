const forge = require('node-forge');
const billAvenueConfig = require('../../../config/billavenue');

/**
 * BillAvenue AES-128-CBC encryption — matches the reference PHP implementation:
 *   Key = hextobin(md5(apiKey))  → raw 16-byte MD5 digest
 *   IV  = pack("C*", 0x00..0x0f) → bytes 0x00–0x0f
 *   Encrypt output : hex string  (PHP bin2hex)
 *   Decrypt input  : hex string  (PHP hextobin)
 */

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
function decrypt(encryptedHex) {
  const clean = String(encryptedHex).trim();
  const key = getKey();
  const encryptedBytes = forge.util.hexToBytes(clean);
  const decipher = forge.cipher.createDecipher('AES-CBC', key);
  decipher.start({ iv: IV });
  decipher.update(forge.util.createBuffer(encryptedBytes));
  const ok = decipher.finish();
  if (!ok) throw new Error('AES decryption failed — bad key, IV, or ciphertext');
  return decipher.output.toString('utf8');
}

module.exports = { encrypt, decrypt };

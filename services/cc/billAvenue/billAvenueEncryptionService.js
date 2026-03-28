const forge = require('node-forge');
const billAvenueConfig = require('../../../config/billavenue');

/**
 * BillAvenue uses AES-128-CBC encryption.
 * Key  = first 16 bytes of MD5(apiKey)   (node-forge: pure-JS, no OpenSSL dependency)
 * IV   = fixed "BillAvenue@12345" (16 bytes)
 */
const IV = 'BillAvenue@12345';

function getKey() {
  const md = forge.md.md5.create();
  md.update(billAvenueConfig.apiKey, 'utf8');
  return md.digest().getBytes(); // 16-byte binary string
}

/**
 * Encrypt plaintext (typically XML) → Base64 ciphertext.
 */
function encrypt(plainText) {
  const key = getKey();
  const cipher = forge.cipher.createCipher('AES-CBC', key);
  cipher.start({ iv: IV });
  cipher.update(forge.util.createBuffer(plainText, 'utf8'));
  cipher.finish();
  return forge.util.encode64(cipher.output.getBytes());
}

/**
 * Decrypt Base64 ciphertext → plaintext (typically XML).
 * Strips surrounding whitespace from the input before decoding to
 * avoid "wrong block length" errors from stray newlines/spaces.
 */
function decrypt(encryptedBase64) {
  const clean = String(encryptedBase64).trim();
  const key = getKey();
  const decipher = forge.cipher.createDecipher('AES-CBC', key);
  decipher.start({ iv: IV });
  decipher.update(forge.util.createBuffer(forge.util.decode64(clean)));
  const ok = decipher.finish();
  if (!ok) throw new Error('AES decryption failed — bad key, IV, or ciphertext');
  return decipher.output.toString('utf8');
}

module.exports = { encrypt, decrypt };

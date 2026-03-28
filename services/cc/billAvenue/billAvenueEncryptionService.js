const crypto = require('crypto');
const billAvenueConfig = require('../../../config/billavenue');

/**
 * BillAvenue uses AES-128-CBC encryption.
 * Key  = first 16 bytes of MD5(apiKey)
 * IV   = fixed "BillAvenue@12345" (16 bytes)
 */
const IV = Buffer.from('BillAvenue@12345', 'utf8');

function getKey() {
  const md5 = crypto.createHash('md5').update(billAvenueConfig.apiKey).digest();
  return md5; // 16-byte buffer
}

/**
 * Encrypt plaintext (typically XML) → Base64 ciphertext.
 */
function encrypt(plainText) {
  const cipher = crypto.createCipheriv('aes-128-cbc', getKey(), IV);
  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

/**
 * Decrypt Base64 ciphertext → plaintext (typically XML).
 */
function decrypt(encryptedBase64) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', getKey(), IV);
  let decrypted = decipher.update(encryptedBase64, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };

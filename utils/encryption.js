const crypto = require('crypto');

// Get these from .env or config files
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // 32 bytes for AES-256
const ENCRYPTION_IV = process.env.ENCRYPTION_IV;   // 16 bytes for AES-256-CBC

// Sanity check (optional)
if (!ENCRYPTION_KEY || !ENCRYPTION_IV) {
  throw new Error('Encryption key or IV missing. Please check your environment variables!');
}

/**
 * Encrypt request data using AES-256-CBC
 * @param {Object} requestData - The request object to encrypt
 * @returns {String} - Base64 encoded encrypted string
 */
const encryptRequest = (requestData) => {
  try {
    const jsonString = JSON.stringify(requestData);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf8'), Buffer.from(ENCRYPTION_IV, 'utf8'));

    let encrypted = cipher.update(jsonString, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    console.log('Encrypted Payload:', encrypted);

    return encrypted;
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Encryption failed');
  }
};

/**
 * Decrypt response data using AES-256-CBC
 * @param {String} encryptedData - The encrypted base64 string
 * @returns {Object} - Decrypted JSON object
 */
const decryptResponse = (encryptedData) => {
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf8'), Buffer.from(ENCRYPTION_IV, 'utf8'));

    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    console.log('Decrypted Payload:', decrypted);

    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Decryption failed');
  }
};

module.exports = {
  encryptRequest,
  decryptResponse
};

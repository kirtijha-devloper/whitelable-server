const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let cachedPublicKey = null;
let cachedPublicKeyPath = null;

function resolvePublicKeyPath() {
  const configuredPath = process.env.SEVENPAY_PUBLIC_KEY_PATH;
  if (!configuredPath) {
    throw new Error('SEVENPAY_PUBLIC_KEY_PATH is not configured.');
  }

  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(process.cwd(), configuredPath);
}


function loadPublicKey() {
  if (cachedPublicKey) {
    return cachedPublicKey;
  }

  // The NEW working public key provided by the SevenPay team for UAT
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo84Y6B/A7NrhugpsxmY6
FlrtHxLWYlfgJ70+WkkkEoerV+xbGLpVIfosaiX+SP0bgjDewI0cOHmhwxqF4DYc
fBRZSrRDeKKtHuK1FkI54ASKyBp0q8KHIf1Csyrru8d9Je5Sg8Z3N/h/klR+Js88
cVtCQbal453sYXccN0ixcMn6E+C1l+NpweAQGO5l2O7Svhs+4iK8VsDzZcGzoe5N
MVD6fqvEdZ46M+AKRiClHbsvkMlZs6y8Q3/u5RGCIzO5MgSK6/W8eF5nSpcmOJ8P
kIs9kXM88EY1lAlb726HjPXG5jLuHlW8xA/9AWnagfhNv51INqcr7Yzxbq5N0qkl
jwIDAQAB
-----END PUBLIC KEY-----`;

  cachedPublicKey = crypto.createPublicKey(publicKeyPem);
  return cachedPublicKey;
}

function loadPublicKey_backup() {
  const publicKeyPath = resolvePublicKeyPath();
  if (cachedPublicKey && cachedPublicKeyPath === publicKeyPath) {
    return cachedPublicKey;
  }

  const keyBuffer = fs.readFileSync(publicKeyPath);
  let keyObject;

  try {
    const keyString = keyBuffer.toString('utf8');
    if (keyString.includes('BEGIN CERTIFICATE')) {
      keyObject = new crypto.X509Certificate(keyString).publicKey;
    } else if (keyString.includes('BEGIN PUBLIC KEY')) {
      keyObject = crypto.createPublicKey(keyString);
    } else {
      keyObject = new crypto.X509Certificate(keyBuffer).publicKey;
    }
  } catch (_error) {
    keyObject = crypto.createPublicKey({ key: keyBuffer, format: 'der', type: 'spki' });
  }

  cachedPublicKey = keyObject;
  cachedPublicKeyPath = publicKeyPath;
  return cachedPublicKey;
}

function encryptJsonPayload(payload) {
  const publicKey = loadPublicKey();
  const plaintext = JSON.stringify(payload ?? {});
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  const encryptedPayload = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]).toString('base64');

  const encryptedKey = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    aesKey
  ).toString('base64');

  const encryptedIv = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    iv
  ).toString('base64');

  return {
    plaintext,
    encryptedPayload,
    encryptedKey,
    encryptedIv,
    aesKey,
    iv,
  };
}

function decryptAesFromBase64(encryptedBase64, key, iv) {
  if (encryptedBase64 == null) {
    throw new Error("Encrypted response payload is null or undefined");
  }

  let normalized = encryptedBase64;
  if (typeof normalized !== 'string') {
    normalized = JSON.stringify(normalized);
  }
  normalized = normalized.trim();
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = JSON.parse(normalized);
  }

  const encryptedBytes = Buffer.from(normalized, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false);

  let decryptedBytes = Buffer.concat([
    decipher.update(encryptedBytes),
    decipher.final()
  ]);

  return decryptedBytes.toString('utf8').replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}

module.exports = {
  encryptJsonPayload,
  decryptAesFromBase64,
  resolvePublicKeyPath,
};
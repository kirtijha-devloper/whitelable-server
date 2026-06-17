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
  const publicKeyPath = resolvePublicKeyPath();

  if (cachedPublicKey && cachedPublicKeyPath === publicKeyPath) {
    return cachedPublicKey;
  }

  let keyString = fs.readFileSync(publicKeyPath, 'utf8');

  // Clean up any stray whitespace/leading spaces from copy-pasting
  keyString = keyString.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n');

  cachedPublicKey = crypto.createPublicKey(keyString);
  cachedPublicKeyPath = publicKeyPath;

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
  };
}

module.exports = {
  encryptJsonPayload,
  resolvePublicKeyPath,
};
const axios = require('axios');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const VIMO_LOG_FILE = path.join(__dirname, '../logs/vimo.log');
function logVimo(label, data) {
  try {
    const ts = new Date().toISOString();
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.appendFileSync(VIMO_LOG_FILE, `[${ts}] ${label}\n${body}\n\n`);
  } catch (_) { /* never crash on log failure */ }
}

class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.code = options.code || 'APP_ERROR';
    this.statusCode = options.statusCode || 500;
    this.details = options.details || null;
  }
}

function isHexString(value) {
  return typeof value === 'string' && value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
}

function resolveBufferFromValue(value, encoding, label) {
  if (!value) {
    throw new AppError('Invalid crypto configuration', {
      code: 'INVALID_CRYPTO_CONFIG',
      statusCode: 500,
      details: `${label} is empty.`,
    });
  }

  if (encoding === 'utf8') {
    return Buffer.from(value, 'utf8');
  }

  if (encoding === 'hex') {
    if (!isHexString(value)) {
      throw new AppError('Invalid crypto configuration', {
        code: 'INVALID_CRYPTO_CONFIG',
        statusCode: 500,
        details: `${label} is not a valid hex string.`,
      });
    }

    return Buffer.from(value, 'hex');
  }

  if (encoding === 'auto') {
    return isHexString(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'utf8');
  }

  throw new AppError('Invalid crypto configuration', {
    code: 'INVALID_CRYPTO_CONFIG',
    statusCode: 500,
    details: `Unsupported ${label} encoding: ${encoding}`,
  });
}

function getAesGcmAlgorithm(keyBuffer) {
  if (keyBuffer.length === 16) return 'aes-128-gcm';
  if (keyBuffer.length === 24) return 'aes-192-gcm';
  if (keyBuffer.length === 32) return 'aes-256-gcm';

  throw new AppError('Invalid crypto configuration', {
    code: 'INVALID_CRYPTO_CONFIG',
    statusCode: 500,
    details: 'AES-GCM key must resolve to 16, 24, or 32 bytes.',
  });
}

function buildIvBuffer(ivSourceBuffer, ivLength) {
  if (ivSourceBuffer.length === 0) {
    throw new AppError('Invalid crypto configuration', {
      code: 'INVALID_CRYPTO_CONFIG',
      statusCode: 500,
      details: 'IV source is empty.',
    });
  }

  if (!Number.isInteger(ivLength) || ivLength <= 0) {
    return ivSourceBuffer;
  }

  if (ivSourceBuffer.length === ivLength) {
    return ivSourceBuffer;
  }

  if (ivSourceBuffer.length > ivLength) {
    return ivSourceBuffer.subarray(0, ivLength);
  }

  const ivBuffer = Buffer.alloc(ivLength);
  ivSourceBuffer.copy(ivBuffer);
  return ivBuffer;
}

function createCryptoContext(overrides = {}) {
  const keySource = process.env.VIMO_CRYPTO_KEY_SOURCE || 'secretKey';
  const ivSource = process.env.VIMO_CRYPTO_IV_SOURCE || 'saltKey';
  const keyEncoding = overrides.keyEncoding || process.env.VIMO_CRYPTO_KEY_ENCODING || 'utf8';
  const ivEncoding = overrides.ivEncoding || process.env.VIMO_CRYPTO_IV_ENCODING || 'utf8';
  const ivLength = Object.prototype.hasOwnProperty.call(overrides, 'ivLength')
    ? overrides.ivLength
    : Number(process.env.VIMO_GCM_IV_BYTES || 0) || null;

  const keyCandidates = {
    secretKey: vimoCredentials.secretKey,
    saltKey: vimoCredentials.saltKey,
    encryptdecryptKey: vimoCredentials.encryptdecryptKey,
  };

  const ivCandidates = {
    secretKey: vimoCredentials.secretKey,
    saltKey: vimoCredentials.saltKey,
    encryptdecryptKey: vimoCredentials.encryptdecryptKey,
  };

  const key = keyCandidates[keySource] || vimoCredentials.encryptdecryptKey;
  const ivSourceValue = ivCandidates[ivSource] || vimoCredentials.saltKey;

  if (!key || !ivSourceValue) {
    throw new AppError('Vimo crypto keys missing', {
      code: 'VIMO_CRYPTO_CONFIG_MISSING',
      statusCode: 500,
      details: `Key source (${keySource}) or IV source (${ivSource}) is not configured`,
    });
  }

  const keyBuffer = resolveBufferFromValue(key, keyEncoding, 'Crypto key');
  const ivSourceBuffer = resolveBufferFromValue(ivSourceValue, ivEncoding, 'IV source');
  const ivBuffer = buildIvBuffer(ivSourceBuffer, ivLength);

  return {
    algorithm: getAesGcmAlgorithm(keyBuffer),
    keyBuffer,
    ivBuffer,
    authTagLength: 16,
  };
}

function getCryptoCandidateContexts() {
  const configs = [];
  const seenSignatures = new Set();

  const addCandidate = (overrides = {}) => {
    try {
      const ctx = createCryptoContext(overrides);
      const signature = `${ctx.algorithm}|${ctx.keyBuffer.length}|${ctx.ivBuffer.length}|${ctx.authTagLength}`;
      if (!seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        configs.push(ctx);
      }
    } catch (_) {
      // skip invalid context
    }
  };

  addCandidate();
  addCandidate({ ivLength: null });
  addCandidate({ keyEncoding: 'auto', ivEncoding: 'auto', ivLength: null });
  addCandidate({ keyEncoding: 'hex', ivEncoding: 'hex', ivLength: null });
  addCandidate({ keyEncoding: 'utf8', ivEncoding: 'utf8', ivLength: null });
  addCandidate({ keyEncoding: 'hex', ivEncoding: 'hex', ivLength: 12 });
  addCandidate({ keyEncoding: 'utf8', ivEncoding: 'utf8', ivLength: 12 });

  if (configs.length === 0) {
    throw new AppError('Invalid crypto configuration', {
      code: 'INVALID_CRYPTO_CONFIG',
      statusCode: 500,
      details: 'Unable to derive a valid AES-GCM crypto context.',
    });
  }

  return configs;
}

function decryptAesGcm(base64CipherText) {
  if (!base64CipherText || typeof base64CipherText !== 'string') {
    throw new AppError('Decryption failure', {
      code: 'DECRYPTION_FAILURE',
      statusCode: 502,
      details: 'Encrypted payload must be a base64 string.',
    });
  }

  const encryptedBuffer = Buffer.from(base64CipherText, 'base64');
  if (encryptedBuffer.length <= 16) {
    throw new AppError('Decryption failure', {
      code: 'DECRYPTION_FAILURE',
      statusCode: 502,
      details: 'Encrypted payload is too short to contain a valid auth tag.',
    });
  }

  let lastError = null;

  for (const ctx of getCryptoCandidateContexts()) {
    try {
      const authTag = encryptedBuffer.subarray(encryptedBuffer.length - ctx.authTagLength);
      const ciphertext = encryptedBuffer.subarray(0, encryptedBuffer.length - ctx.authTagLength);

      const decipher = crypto.createDecipheriv(ctx.algorithm, ctx.keyBuffer, ctx.ivBuffer, {
        authTagLength: ctx.authTagLength,
      });
      decipher.setAuthTag(authTag);

      const decryptedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const result = decryptedBuffer.toString('utf8');
      console.debug('Vimo decrypted by AES-GCM', { len: result.length, algorithm: ctx.algorithm });
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw new AppError('Decryption failure', {
    code: 'DECRYPTION_FAILURE',
    statusCode: 502,
    details: lastError ? lastError.message : 'Unable to authenticate encrypted payload.',
  });
}

const tryAesCbcDecrypt = (text) => {
  const keySource = process.env.VIMO_CRYPTO_KEY_SOURCE || 'secretKey';
  const ivSource = process.env.VIMO_CRYPTO_IV_SOURCE || 'saltKey';
  const keyEncoding = process.env.VIMO_CRYPTO_KEY_ENCODING || 'utf8';
  const ivEncoding = process.env.VIMO_CRYPTO_IV_ENCODING || 'utf8';

  const keyCandidates = {
    secretKey: vimoCredentials.secretKey,
    saltKey: vimoCredentials.saltKey,
    encryptdecryptKey: vimoCredentials.encryptdecryptKey,
  };
  const ivCandidates = {
    secretKey: vimoCredentials.secretKey,
    saltKey: vimoCredentials.saltKey,
    encryptdecryptKey: vimoCredentials.encryptdecryptKey,
  };

  const key = keyCandidates[keySource] || vimoCredentials.encryptdecryptKey;
  const iv = ivCandidates[ivSource] || vimoCredentials.saltKey;

  const keyBuf = resolveBufferFromValue(key, keyEncoding, 'Crypto key');
  const ivBuf = resolveBufferFromValue(iv, ivEncoding, 'IV source');

  if (![16, 24, 32].includes(keyBuf.length) || ivBuf.length !== 16) {
    throw new AppError('Invalid Vimo crypto key/iv length', {
      code: 'VIMO_CRYPTO_INVALID_LENGTH',
      statusCode: 500,
      details: `Key length=${keyBuf.length}, iv length=${ivBuf.length}`,
    });
  }

  const algorithm = `aes-${keyBuf.length * 8}-cbc`;
  const encryptedBuffer = Buffer.from(text, 'base64');
  const decipher = crypto.createDecipheriv(algorithm, keyBuf, ivBuf);
  const decryptedBuffer = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
  return decryptedBuffer.toString('utf8');
};

const decryptCipherText = (text) => {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // First try AES-GCM with multiple key/iv formats from configs.
  try {
    return decryptAesGcm(text);
  } catch (gcmErr) {
    console.warn('Vimo AES-GCM decrypt failed:', gcmErr.message || gcmErr);
  }

  // Then try AES-CBC as fallback.
  try {
    const decrypted = tryAesCbcDecrypt(text);
    if (decrypted && decrypted.trim().length > 0) {
      console.debug('Vimo decrypted by AES-CBC', { len: decrypted.length });
      return decrypted;
    }
  } catch (cbcErr) {
    console.warn('Vimo AES-CBC decrypt failed:', cbcErr.message || cbcErr);
  }

  // Fallback: base64-decoded plaintext.
  try {
    const plain = Buffer.from(text, 'base64').toString('utf8');
    if (plain && plain.trim().length > 0) {
      console.debug('Vimo base64 decode successful (no AES)', { len: plain.length });
      return plain;
    }
  } catch (base64Err) {
    console.warn('Vimo base64 fallback failed:', base64Err.message || base64Err);
  }

  return text;
};

const encryptAesGcm = (text) => {
  const ctx = createCryptoContext();
  const cipher = crypto.createCipheriv(ctx.algorithm, ctx.keyBuffer, ctx.ivBuffer, {
    authTagLength: ctx.authTagLength,
  });
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([encrypted, authTag]).toString('base64');
};

const encryptPlainText = (text) => {
  try {
    return encryptAesGcm(text);
  } catch (err) {
    console.warn('Vimo AES-GCM encrypt failed, falling back to plain text:', err.message);
    return text;
  }
};

const reservePayoutWindow = (payload) => ({
  keepWindow: () => {},
  release: () => {},
});

const vimoBaseURL = process.env.VIMO_BASE_URL;
const vimoTimeoutMs = Number(process.env.VIMO_TIMEOUT_MS || 15000);
const vimoCredentials = {
  secretKey: process.env.VIMO_SECRET_KEY,
  saltKey: process.env.VIMO_SALT_KEY,
  encryptdecryptKey: process.env.VIMO_ENCRYPTDECRYPT_KEY || process.env.VIMO_ENCRYPT_KEY,
  userId: process.env.VIMO_USER_ID,
};

// For local dev/test, allow missing Vimo env vars and disable live payout.
// Set these values in production when Vimo integration is required.
if (!vimoBaseURL) {
  console.warn('VIMO_BASE_URL not configured; Vimo payout API will be unavailable.');
}
if (!vimoCredentials.secretKey || !vimoCredentials.saltKey || !vimoCredentials.encryptdecryptKey || !vimoCredentials.userId) {
  console.warn('Vimo credentials not configured; Vimo payout API will be unavailable.');
}

const vimoClient = axios.create({
  baseURL: vimoBaseURL,
  timeout: vimoTimeoutMs,
});

const tokenCache = {
  value: null,
  expiresAt: 0,
  authorizeResponse: null,
};


const payoutResponseFields = [
  'txnStatus',
  'rrn',
  'txnStatusCode',
  'responseMessage',
  'txnId',
  'amount',
  'paymentMode',
  'paymentPurpose',
  'merchantRefId',
  'beneficiaryBank',
  'beneficiaryAccountNumber',
  'beneficiaryIFSC',
  'beneficiaryMobileNumber',
  'beneficiaryLocation',
  'beneficiaryName',
  'charges',
  'lat',
  'long',
  'udf1',
  'udf2',
  'udf3',
];

function normalizeDecryptedEnvelope(bankResponse, defaultMessage) {
  // Detect plain error envelope (successStatus: false, data: null) — not encrypted
  if (
    bankResponse &&
    typeof bankResponse === 'object' &&
    bankResponse.successStatus === false &&
    bankResponse.data === null
  ) {
    throw new AppError(bankResponse.message || 'Payout failed', {
      code: 'PAYOUT_PROVIDER_ERROR',
      statusCode: 502,
      details: `Provider responseCode: ${bankResponse.responseCode || 'unknown'}, message: ${bankResponse.message || 'Failed'}`,
    });
  }

  const encryptedPayload = extractEncryptedPayload(bankResponse);
  let decryptedText = decryptCipherText(encryptedPayload);

  if (Buffer.isBuffer(decryptedText)) {
    decryptedText = decryptedText.toString('utf8');
  }

  let parsedPayload = parseMaybeJson(decryptedText);

  if (typeof parsedPayload === 'string' && parsedPayload === decryptedText) {
    const decompressed = tryDecompressIfNeeded(decryptedText);
    if (decompressed && decompressed !== decryptedText) {
      decryptedText = decompressed;
      parsedPayload = parseMaybeJson(decompressed);
    }
  }

  if (!parsedPayload) {
    throw new AppError('Invalid bank response', {
      code: 'INVALID_BANK_RESPONSE',
      statusCode: 502,
      details: 'Bank response was empty after decryption.',
    });
  }

  if (typeof parsedPayload === 'object') {
    return {
      raw: parsedPayload,
      message:
        parsedPayload.message ||
        parsedPayload.responseMessage ||
        bankResponse?.message ||
        defaultMessage,
      responseCode:
        parsedPayload.responseCode ||
        parsedPayload.txnStatusCode ||
        bankResponse?.responseCode ||
        '000',
      data: Object.prototype.hasOwnProperty.call(parsedPayload, 'data')
        ? parsedPayload.data
        : parsedPayload,
    };
  }

  return {
    raw: parsedPayload,
    message: bankResponse?.message || defaultMessage,
    responseCode: bankResponse?.responseCode || '000',
    data: parsedPayload,
  };
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

function tryDecompressIfNeeded(text) {
  if (text == null) {
    return null;
  }

  let sourceBuffer;
  if (Buffer.isBuffer(text)) {
    sourceBuffer = text;
  } else if (typeof text === 'string') {
    sourceBuffer = Buffer.from(text, 'binary');
  } else {
    return null;
  }

  const strategies = [
    {name: 'gzip', fn: zlib.gunzipSync},
    {name: 'inflate', fn: zlib.inflateSync},
    {name: 'inflateRaw', fn: zlib.inflateRawSync},
    {name: 'unzip', fn: zlib.unzipSync},
  ];

  for (const {name, fn} of strategies) {
    try {
      const decompressed = fn(sourceBuffer);
      if (decompressed && decompressed.length > 0) {
        const asText = decompressed.toString('utf8');
        console.debug(`Vimo decompressed using ${name}`, { len: asText.length });
        return asText;
      }
    } catch (err) {
      // fallback only
    }
  }

  if (typeof text === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(text.trim())) {
    try {
      const decoded = Buffer.from(text, 'base64');
      if (decoded.length > 0) {
        try {
          const unzipped = zlib.gunzipSync(decoded);
          return unzipped.toString('utf8');
        } catch (err) {}

        return decoded.toString('utf8');
      }
    } catch (err) {
      // Ignore base64 fallback failures.
    }
  }

  return null;
}

function extractEncryptedPayload(responseBody) {
  if (typeof responseBody === 'string') {
    return responseBody;
  }

  if (responseBody && typeof responseBody.data === 'string') {
    return responseBody.data;
  }

  if (responseBody && typeof responseBody.responseData === 'string') {
    return responseBody.responseData;
  }

  if (responseBody && responseBody.data && typeof responseBody.data === 'object') {
    if (typeof responseBody.data.data === 'string') {
      return responseBody.data.data;
    }
    if (typeof responseBody.data.responseData === 'string') {
      return responseBody.data.responseData;
    }
  }

  logVimo('extractEncryptedPayload: no encrypted field found', responseBody);
  throw new AppError('Invalid bank response', {
    code: 'INVALID_BANK_RESPONSE',
    statusCode: 502,
    details: 'Encrypted payload field was not found in the bank response.',
  });
}

function normalizeAuthorizeResponse(responseBody) {
  const parsedBody = parseMaybeJson(responseBody);

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    throw new AppError('Invalid bank response', {
      code: 'INVALID_BANK_RESPONSE',
      statusCode: 502,
      details: 'Authorize API did not return the expected JSON response.',
    });
  }

  return {
    successStatus: parsedBody.successStatus === true || parsedBody.success === true,
    message: parsedBody.message || 'Success',
    responseCode: parsedBody.responseCode || parsedBody.code || '000',
    data: parsedBody.data,
  };
}

function extractTokenFromPayload(payload) {
  const candidateValues = [];

  if (typeof payload === 'string') {
    candidateValues.push(payload);
  }

  if (payload && typeof payload === 'object') {
    candidateValues.push(
      payload.token,
      payload.accessToken,
      payload.authToken,
      payload.bearerToken,
      payload.data,
      payload.data?.token,
      payload.data?.accessToken,
      payload.data?.authToken,
      payload.data?.bearerToken,
      payload.data?.data,
      payload.data?.data?.token,
      payload.data?.data?.accessToken,
      payload.data?.result,
      payload.data?.result?.token,
      payload.result,
      payload.result?.token
    );
  }

  const tokenValue = candidateValues.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);

  if (!tokenValue) {
    throw new AppError('Token generation failure', {
      code: 'TOKEN_GENERATION_FAILED',
      statusCode: 502,
      details: 'Authorize API did not return a usable token.',
    });
  }

  return tokenValue.replace(/^Bearer\s+/i, '').trim();
}

async function fetchFreshToken() {
  try {
    const requestHeaders = {
      secretKey: vimoCredentials.secretKey,
      saltKey: vimoCredentials.saltKey,
      encryptdecryptKey: vimoCredentials.encryptdecryptKey,
      userId: vimoCredentials.userId,
    };

    const endpoint = '/payoutapi/api/signature/authorize';
    const response = await vimoClient.post(endpoint, {}, {
      headers: requestHeaders,
    });

    logVimo('fetchFreshToken raw response', {
      userId: vimoCredentials.userId,
      request: {
        endpoint,
        headers: requestHeaders,
      },
      status: response.status,
      headers: response.headers,
      data: response.data,
    });

    const authorizeResponse = normalizeAuthorizeResponse(response.data);
    logVimo('fetchFreshToken normalized authorize response', authorizeResponse);

    const tokenValue = extractTokenFromPayload(authorizeResponse);

    tokenCache.value = tokenValue;
    tokenCache.expiresAt = Date.now() + Number(process.env.VIMO_TOKEN_TTL_MS || 600000);
    tokenCache.authorizeResponse = {
      successStatus: authorizeResponse.successStatus,
      message: authorizeResponse.message,
      responseCode: authorizeResponse.responseCode,
      data: tokenValue,
    };

    return tokenCache.authorizeResponse;
  } catch (error) {
    tokenCache.value = null;
    tokenCache.expiresAt = 0;
    tokenCache.authorizeResponse = null;

    logVimo('fetchFreshToken error', {
      userId: vimoCredentials.userId,
      request: {
        endpoint: '/payoutapi/api/signature/authorize',
        headers: requestHeaders,
      },
      message: error.message,
      code: error.code,
      status: error.response?.status,
      responseData: error.response?.data,
      stack: error.stack,
    });

    if (error instanceof AppError) {
      throw error;
    }

    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      throw new AppError('Token generation failure', {
        code: 'BANK_TIMEOUT',
        statusCode: 504,
        details: error.message,
      });
    }

    if (axios.isAxiosError(error)) {
      throw new AppError('Token generation failure', {
        code: 'TOKEN_GENERATION_FAILED',
        statusCode: error.response?.status || 502,
        details: error.response?.data || error.message,
      });
    }

    throw new AppError('Token generation failure', {
      code: 'TOKEN_GENERATION_FAILED',
      statusCode: 502,
      details: error.message,
    });
  }
}

async function getBearerToken(options = {}) {
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && tokenCache.value && tokenCache.expiresAt > Date.now()) {
    return tokenCache.value;
  }

  const authorizeResponse = await fetchFreshToken();
  return authorizeResponse.data;
}

async function getAuthorizeTokenResponse(options = {}) {
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && tokenCache.authorizeResponse && tokenCache.expiresAt > Date.now()) {
    return tokenCache.authorizeResponse;
  }

  return fetchFreshToken();
}

function buildAuthorizedHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    userId: vimoCredentials.userId,
  };
}

function sanitizePayoutResponse(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const filteredPayload = {};

  payoutResponseFields.forEach((fieldName) => {
    if (payload[fieldName] !== undefined) {
      filteredPayload[fieldName] = payload[fieldName];
    }
  });

  return Object.keys(filteredPayload).length > 0 ? filteredPayload : payload;
}

function validatePayoutPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('Missing payout payload fields', {
      code: 'MISSING_PAYOUT_FIELDS',
      statusCode: 400,
      details: 'Request body must be a JSON object.',
    });
  }

  const requiredFields = [
    'amount',
    'merchantRefId',
    'beneficiaryBank',
    'paymentPurpose',
    'paymentMode',
    'beneficiaryAccountNumber',
    'beneficiaryIFSC',
    'beneficiaryMobileNumber',
    'beneficiaryName',
    'beneficiaryLocation',
    'lat',
    'long',
  ];

  const missingFields = requiredFields.filter((fieldName) => {
    const fieldValue = payload[fieldName];
    if (fieldValue === undefined || fieldValue === null) {
      return true;
    }
    return typeof fieldValue === 'string' && fieldValue.trim() === '';
  });

  if (missingFields.length > 0) {
    throw new AppError('Missing payout payload fields', {
      code: 'MISSING_PAYOUT_FIELDS',
      statusCode: 400,
      details: `Missing required fields: ${missingFields.join(', ')}`,
    });
  }
}

async function executeAuthorizedRequest(requestFactory) {
  let token = await getBearerToken();
  try {
    return await requestFactory(token);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      token = await getBearerToken({ forceRefresh: true });
      return requestFactory(token);
    }
    throw error;
  }
}

async function fetchEncryptedList(path, successMessage) {
  try {
    const response = await executeAuthorizedRequest((token) =>
      vimoClient.get(path, {
        headers: buildAuthorizedHeaders(token),
      })
    );

    const normalizedResponse = normalizeDecryptedEnvelope(response.data, successMessage);

    return {
      message: successMessage,
      responseCode: normalizedResponse.responseCode,
      data: normalizedResponse.data,
    };
  } catch (error) {
    if (error.code === 'BANK_TIMEOUT' || error.statusCode) {
      throw error;
    }
    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      throw new AppError('Bank request timed out', {
        code: 'BANK_TIMEOUT',
        statusCode: 504,
        details: error.message,
      });
    }
    throw new AppError('Bank API request failed', {
      code: 'BANK_API_ERROR',
      statusCode: error.response?.status || 502,
      details: error.response?.data || error.message,
    });
  }
}

async function fetchBankList() {
  return fetchEncryptedList('/masterapi/api/master/banklist', 'Bank list fetched successfully');
}

async function fetchPurposeList() {
  return fetchEncryptedList('/masterapi/api/master/purposelist', 'Purpose list fetched successfully');
}

async function fetchStateList() {
  return fetchEncryptedList('/masterapi/api/master/statelist', 'State list fetched successfully');
}

async function createPayout(payload) {
  validatePayoutPayload(payload);

  const payoutReservation = reservePayoutWindow(payload);
  let response;

  try {
    let requestBody;
    response = await executeAuthorizedRequest((token) => {
      const headers = {
        ...buildAuthorizedHeaders(token),
        'Content-Type': 'application/json',
      };
      requestBody = { requestBody: encryptPlainText(JSON.stringify(payload)) };

      logVimo('createPayout outgoing request', {
        url: vimoBaseURL + '/payoutapi/api/payment/payouts',
        method: 'POST',
        headers: { userId: headers.userId, hasToken: Boolean(token) },
        rawPayload: payload,
        encryptedBody: requestBody,
      });

      return vimoClient.post('/payoutapi/api/payment/payouts', requestBody, { headers });
    });

    logVimo('createPayout provider response', {
      status: response.status,
      headers: response.headers,
      data: response.data,
    });

    const normalizedResponse = normalizeDecryptedEnvelope(response.data, 'Payout processed successfully');
    logVimo('createPayout decrypted provider response', {
      normalizedResponse: {
        message: normalizedResponse.message,
        responseCode: normalizedResponse.responseCode,
        data: normalizedResponse.data,
        raw: normalizedResponse.raw,
      },
    });

    if (typeof response?.data?.data === 'string' && response.data.data.trim() !== '') {
      payoutReservation.keepWindow();
    }

    payoutReservation.keepWindow();

    const payoutPayload =
      normalizedResponse.data && typeof normalizedResponse.data === 'object'
        ? normalizedResponse.data
        : normalizedResponse.raw;

    return {
      message:
        normalizedResponse.raw?.responseMessage ||
        normalizedResponse.raw?.message ||
        'Payout processed successfully',
      responseCode: normalizedResponse.raw?.txnStatusCode || normalizedResponse.responseCode,
      data: sanitizePayoutResponse(payoutPayload),
    };
  } catch (error) {
    payoutReservation.release();

    logVimo('createPayout provider error', {
      message: error.message,
      code: error.code,
      status: error.response?.status || error.statusCode,
      responseData: error.response?.data,
      providerResponse: response?.data,
      details: error.details || null,
    });

    if (error.code === 'PAYOUT_PROVIDER_ERROR') {
      logVimo('createPayout provider failure details', {
        reason: 'Provider returned explicit failure envelope',
        rawProviderData: response?.data,
        providerErrorDetails: error.details || error.message,
      });
    }

    if (error.code === 'DECRYPTION_FAILURE' || error.code === 'INVALID_BANK_RESPONSE') {
      logVimo('createPayout decryption failure', {
        reason: 'Unable to decode or parse bank response',
        rawProviderData: response?.data,
        errorDetails: error.details || error.message,
      });
    }

    if (error.code === 'BANK_TIMEOUT' || error.statusCode) {
      throw error;
    }

    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      throw new AppError('Bank request timed out', {
        code: 'BANK_TIMEOUT',
        statusCode: 504,
        details: error.message,
      });
    }

    throw new AppError('Bank API request failed', {
      code: 'BANK_API_ERROR',
      statusCode: error.response?.status || 502,
      details: error.response?.data || error.message,
    });
  }
}

module.exports = {
  fetchBankList,
  fetchPurposeList,
  fetchStateList,
  createPayout,
  getAuthorizeTokenResponse,
};

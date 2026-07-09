const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { encryptJsonPayload, decryptAesFromBase64 } = require('../utils/sevenpayEncryption');
const crypto = require('crypto');

const SEVENPAY_LOG_FILE = path.join(__dirname, '../logs/sevenpay.log');

function sevenpayLog(level, message, data) {
  try {
    const ts = new Date().toISOString();
    let extra = '';
    if (data !== undefined) {
      if (typeof data === 'object') {
        extra = ' | ' + JSON.stringify(data);
      } else {
        extra = ' | ' + String(data);
      }
    }
    const line = `[${ts}] [${level}] ${message}${extra}\n`;
    fs.appendFileSync(SEVENPAY_LOG_FILE, line);
    // console.log(`[SevenPay] [${level}] ${message}${extra}`); // Optional console log
  } catch (_) { /* never crash due to log failure */ }
}

const DEFAULT_TIMEOUT_MS = Number(process.env.SEVENPAY_TIMEOUT_MS || 30000);
const DEFAULT_LOGIN_PATH = process.env.SEVENPAY_LOGIN_PATH || '/api/Account/GetToken/Login';
const DEFAULT_PAYOUT_PATH = process.env.SEVENPAY_PAYOUT_INITIATE_PATH || '/api/PayOut/InitiatePayoutNew';
const DEFAULT_STATUS_PATH = process.env.SEVENPAY_PAYOUT_STATUS_PATH || '/api/PayOut/getPayoutStatus';
const DEFAULT_TOKEN_TTL_MS = Number(process.env.SEVENPAY_TOKEN_TTL_MS || 10 * 60 * 1000);
const DEFAULT_CHANNEL_TYPE = process.env.SEVENPAY_CHANNEL_TYPE || 'API';

const tokenCache = {
  token: null,
  expiresAt: 0,
  rawResponse: null,
  userId: null,
  orgId: null,
};

function requireConfig(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function getBaseConfig() {
  return {
    baseURL: requireConfig('SEVENPAY_BASE_URL').replace(/\/+$/, ''),
    timeout: DEFAULT_TIMEOUT_MS,
  };
}

function getAxiosClient() {
  const config = getBaseConfig();
  return axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function resolveUrlPath(pathname) {
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

function buildLoginPayload() {
  return {
    userName: requireConfig('SEVENPAY_USERNAME'),
    password: requireConfig('SEVENPAY_PASSWORD'),
    channelType: DEFAULT_CHANNEL_TYPE,
  };
}

function deriveTokenInfo(rawResponse) {
  const responseCode = String(rawResponse?.responseCode ?? '');
  const isSuccess = responseCode === '0' || responseCode === '1' || rawResponse?.status === 'SUCCESS';
  
  if (responseCode && !isSuccess) {
    const message = rawResponse?.message || rawResponse?.response || rawResponse?.responseDesc || rawResponse?.errors?.[0]?.error || 'Sevenpay login failed.';
    throw new Error(`Sevenpay login failed: ${message}`);
  }

  const candidates = [
    rawResponse?.token,
    rawResponse?.access_token,
    rawResponse?.accessToken,
    rawResponse?.jwt,
    rawResponse?.data?.token,
    rawResponse?.data?.access_token,
    rawResponse?.data?.accessToken,
    rawResponse?.data?.jwt,
    rawResponse?.Data?.token,
    rawResponse?.Data?.accessToken,
    rawResponse?.responseData?.token,
    rawResponse?.responseData?.access_token,
    rawResponse?.responseData?.accessToken,
    rawResponse?.result?.token,
    rawResponse?.result?.accessToken,
  ];

  const token = candidates.find((value) => typeof value === 'string' && value.trim());
  if (!token) {
    throw new Error('Sevenpay login succeeded but no access token was found in the response.');
  }

  const expiresInSeconds = Number(
    rawResponse?.expiresIn
      || rawResponse?.expires_in
      || rawResponse?.data?.expiresIn
      || rawResponse?.data?.expires_in
      || rawResponse?.responseData?.expiresIn
      || rawResponse?.responseData?.expires_in
      || rawResponse?.ttl
      || rawResponse?.data?.ttl
      || 0
  );

  const ttlMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
    ? expiresInSeconds * 1000
    : DEFAULT_TOKEN_TTL_MS;

  return {
    token,
    expiresAt: Date.now() + ttlMs,
    userId: pickFirstValue(
      rawResponse?.responseData?.userId,
      rawResponse?.data?.userId,
      rawResponse?.data?.id,
      rawResponse?.userId,
      process.env.SEVENPAY_USER_ID
    ),
    orgId: pickFirstValue(
      rawResponse?.responseData?.orgId,
      rawResponse?.data?.orgId,
      rawResponse?.orgId,
      process.env.SEVENPAY_ORG_ID
    ),
  };
}

function normalizeStatus(statusRaw) {
  if (!statusRaw) return 'PENDING';
  const value = String(statusRaw).trim().toUpperCase();
  if (['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PROCESSED', 'APPROVED', 'CREDITED'].includes(value)) return 'SUCCESS';
  if (['FAILED', 'FAILURE', 'REJECTED', 'DECLINED', 'CANCELLED', 'ERROR'].includes(value)) return 'FAILED';
  if (['PENDING', 'PROCESSING', 'INPROCESS', 'IN_PROGRESS', 'INITIATED', 'SUBMITTED'].includes(value)) return 'PENDING';
  return 'PENDING';
}

function pickFirstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizePayoutResponse(rawResponse, fallback = {}) {
  const responseData = rawResponse?.data && typeof rawResponse.data === 'object'
    ? rawResponse.data
    : rawResponse;

  const crn = pickFirstValue(
    responseData?.crn,
    responseData?.CRN,
    responseData?.referenceId,
    responseData?.reference_id,
    responseData?.clientRefNo,
    fallback.crn
  );

  const paymentId = pickFirstValue(
    responseData?.paymentId,
    responseData?.payment_id,
    responseData?.txnId,
    responseData?.transactionId,
    responseData?.utrId,
    fallback.paymentId
  );

  const amountValue = pickFirstValue(
    responseData?.amount,
    responseData?.txnAmount,
    responseData?.transactionAmount,
    fallback.amount
  );

  const serviceChargeValue = pickFirstValue(
    responseData?.serviceCharge,
    responseData?.service_charge,
    responseData?.charge,
    responseData?.charges,
    fallback.serviceCharge,
    0
  );

  const bankReferenceNo = pickFirstValue(
    responseData?.bankReferenceNo,
    responseData?.bank_reference_no,
    responseData?.utr,
    responseData?.utrNo,
    responseData?.rrn,
    null
  );

  const statusRaw = pickFirstValue(
    responseData?.status,
    responseData?.Status,
    responseData?.txnStatus,
    responseData?.transactionStatus,
    responseData?.messageStatus,
    fallback.status
  );

  return {
    crn: crn || null,
    paymentId: paymentId || null,
    status: normalizeStatus(statusRaw),
    amount: amountValue !== undefined && amountValue !== null ? String(amountValue) : null,
    serviceCharge: Number(serviceChargeValue || 0),
    bankReferenceNo: bankReferenceNo || null,
    rawResponse,
  };
}

async function login(options = {}) {
  sevenpayLog('INFO', 'Fetching authentication token from Shared API');
  let rawResponse;
  try {
    const sharedLoginId = requireConfig('SEVEN_PAY_SHARED_LOGIN_ID');
    const sharedApiKey = requireConfig('SEVEN_PAY_SHARED_API_KEY');
    
    const response = await axios.get('https://api.abheepay.com/api/shared/7pay-token', {
      headers: {
        'x-7pay-login-id': sharedLoginId,
        'x-7pay-login-api-key': sharedApiKey,
      }
    });
    
    rawResponse = response.data;
    
    sevenpayLog('SUCCESS', 'Shared API Authentication successful', {
      userId: rawResponse?.data?.userId || rawResponse?.userId,
      orgId: rawResponse?.data?.orgId || rawResponse?.orgId,
      responseCode: rawResponse?.responseCode,
    });
  } catch (error) {
    sevenpayLog('ERROR', 'Shared API Authentication failed', {
      message: error.message,
      statusCode: error.response?.status,
      responseData: error.response?.data,
    });
    throw error;
  }
  const tokenInfo = deriveTokenInfo(rawResponse);

  tokenCache.token = tokenInfo.token;
  tokenCache.expiresAt = tokenInfo.expiresAt;
  tokenCache.rawResponse = rawResponse;
  tokenCache.userId = tokenInfo.userId || null;
  tokenCache.orgId = tokenInfo.orgId || null;

  return {
    token: tokenInfo.token,
    cached: false,
    expiresAt: tokenInfo.expiresAt,
    rawResponse,
    userId: tokenInfo.userId || null,
    orgId: tokenInfo.orgId || null,
  };
}

function buildEncryptedRequest(payload) {
  const encrypted = encryptJsonPayload(payload);
  return {
    payload,
    plaintext: encrypted.plaintext,
    headers: {
      key: encrypted.encryptedKey,
      iv: encrypted.encryptedIv,
    },
    aesKey: encrypted.aesKey,
    iv: encrypted.iv,
    body: encrypted.encryptedPayload,
  };
}

async function sendEncryptedRequest({ path, payload, auth }) {
  if (!auth) {
    auth = await login();
  }
  sevenpayLog('INFO', 'Authenticating with SevenPay');

  const client = getAxiosClient();
  const encryptedRequest = buildEncryptedRequest(payload);

  const isGet = path === DEFAULT_STATUS_PATH;
  const requestId = crypto.randomUUID();

  const requestHeaders = {
    Authorization: `Bearer ${auth.token}`,
    key: encryptedRequest.headers.key,
    iv: encryptedRequest.headers.iv,
    'x-request-id': requestId,
    'Content-Type': 'application/json',
  };

  sevenpayLog('INFO', `Sending request to ${path}`, {
    method: isGet ? 'GET' : 'POST',
    isGet,
    headers: requestHeaders,
    plainPayload: payload
  });

  let rawResponse;
  try {
    const axiosConfig = {
      method: isGet ? 'get' : 'post',
      url: resolveUrlPath(path),
      headers: requestHeaders,
      transformRequest: [(data) => data],
      responseType: 'text',
      transformResponse: [(data) => data]
    };

    if (isGet) {
      axiosConfig.params = payload;
    } else {
      axiosConfig.data = encryptedRequest.body;
    }

    const response = await client.request(axiosConfig);

    const decryptedText = decryptAesFromBase64(response.data, encryptedRequest.aesKey, encryptedRequest.iv);
    try {
      rawResponse = JSON.parse(decryptedText);
    } catch {
      rawResponse = decryptedText;
    }

    sevenpayLog('SUCCESS', `Response from ${path}`, rawResponse);

  } catch (error) {
    if (error.response?.data) {
      try {
        const decryptedErrorText = decryptAesFromBase64(error.response.data, encryptedRequest.aesKey, encryptedRequest.iv);
        try {
          error.response.data = JSON.parse(decryptedErrorText);
        } catch {
          error.response.data = decryptedErrorText;
        }
      } catch (err) {}
    }
    sevenpayLog('ERROR', `Request to ${path} failed`, {
      message: error.message,
      statusCode: error.response?.status,
      responseData: error.response?.data,
    });
    throw error;
  }

  return {
    auth,
    encryptedRequest,
    response: rawResponse,
  };
}

async function initiatePayout(payload) {
  const auth = await login();
  const requestPayload = {
    orgId: payload.orgId || auth.orgId || requireConfig('SEVENPAY_ORG_ID'),
    userId: payload.userId || auth.userId || requireConfig('SEVENPAY_USER_ID'),
    paymentMode: payload.paymentMode || 'IMPS',
    refParam1: payload.refParam1 || '',
    refParam2: payload.refParam2 || '',
    refParam3: payload.refParam3 || '',
    ...payload,
  };

  const result = await sendEncryptedRequest({
    path: DEFAULT_PAYOUT_PATH,
    payload: requestPayload,
    auth,
  });

  return {
    ...normalizePayoutResponse(result.response, requestPayload),
    requestPreview: result.encryptedRequest,
    auth: {
      cached: result.auth.cached,
      expiresAt: result.auth.expiresAt,
      userId: result.auth.userId || null,
      orgId: result.auth.orgId || null,
    },
  };
}

async function getPayoutStatus(payload) {
  const queryParams = {};
  if (payload.crn || payload.CRN) queryParams.crnId = payload.crn || payload.CRN;
  if (payload.paymentId) queryParams.paymentId = payload.paymentId;
  if (payload.userId) queryParams.userid = payload.userId;

  const result = await sendEncryptedRequest({
    path: DEFAULT_STATUS_PATH,
    payload: queryParams,
  });

  return {
    ...normalizePayoutResponse(result.response, payload),
    requestPreview: result.encryptedRequest,
    auth: {
      cached: result.auth.cached,
      expiresAt: result.auth.expiresAt,
      userId: result.auth.userId || null,
      orgId: result.auth.orgId || null,
    },
  };
}

function getRequestPreview(type, payload) {
  const config = getBaseConfig();
  const path = type === 'login'
    ? DEFAULT_LOGIN_PATH
    : type === 'status'
      ? DEFAULT_STATUS_PATH
      : DEFAULT_PAYOUT_PATH;

  if (type === 'login') {
    const encryptedRequest = buildEncryptedRequest(buildLoginPayload());
    return {
      url: `${config.baseURL}${resolveUrlPath(path)}`,
      headers: {
        key: encryptedRequest.headers.key,
        iv: encryptedRequest.headers.iv,
        'Content-Type': 'application/json',
      },
      payload: buildLoginPayload(),
      plaintext: encryptedRequest.plaintext,
      body: encryptedRequest.body,
    };
  }

  const encryptedRequest = buildEncryptedRequest(payload);
  return {
    url: `${config.baseURL}${resolveUrlPath(path)}`,
    headers: {
      Authorization: 'Bearer <token>',
      key: encryptedRequest.headers.key,
      iv: encryptedRequest.headers.iv,
      'x-request-id': crypto.randomUUID(),
      'Content-Type': 'application/json',
    },
    payload,
    plaintext: encryptedRequest.plaintext,
    body: encryptedRequest.body,
  };
}

module.exports = {
  login,
  initiatePayout,
  getPayoutStatus,
  getRequestPreview,
  normalizePayoutResponse,
  normalizeStatus,
};

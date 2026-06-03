const axios = require('axios');
const { encryptJsonPayload } = require('../utils/sevenpayEncryption');

const DEFAULT_TIMEOUT_MS = Number(process.env.SEVENPAY_TIMEOUT_MS || 30000);
const DEFAULT_LOGIN_PATH = process.env.SEVENPAY_LOGIN_PATH || '/api/Account/GetToken/Login';
const DEFAULT_PAYOUT_PATH = process.env.SEVENPAY_PAYOUT_INITIATE_PATH || '/api/Payout/initiatePayout';
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
  if (responseCode && responseCode !== '0') {
    const message = rawResponse?.response || rawResponse?.responseDesc || rawResponse?.errors?.[0]?.error || 'Sevenpay login failed.';
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
      rawResponse?.data?.userId,
      rawResponse?.data?.id,
      rawResponse?.userId,
      process.env.SEVENPAY_USER_ID
    ),
    orgId: pickFirstValue(
      rawResponse?.data?.orgId,
      rawResponse?.orgId,
      process.env.SEVENPAY_ORG_ID
    ),
  };
}

function normalizeStatus(statusRaw) {
  if (!statusRaw) return 'PENDING';
  const value = String(statusRaw).trim().toUpperCase();
  if (['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PROCESSED', 'APPROVED'].includes(value)) return 'SUCCESS';
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
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && tokenCache.token && tokenCache.expiresAt > Date.now() + 10 * 1000) {
    return {
      token: tokenCache.token,
      cached: true,
      expiresAt: tokenCache.expiresAt,
      rawResponse: tokenCache.rawResponse,
      userId: tokenCache.userId,
      orgId: tokenCache.orgId,
    };
  }

  const client = getAxiosClient();
  const payload = buildLoginPayload();
  const encryptedRequest = buildEncryptedRequest(payload);
  const response = await client.post(resolveUrlPath(DEFAULT_LOGIN_PATH), encryptedRequest.body, {
    headers: {
      key: encryptedRequest.headers.key,
      iv: encryptedRequest.headers.iv,
      'Content-Type': 'application/json',
    },
  });
  const rawResponse = response.data;
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
    body: JSON.stringify(encrypted.encryptedPayload),
  };
}

async function sendEncryptedRequest({ path, payload }) {
  const auth = await login();
  const client = getAxiosClient();
  const encryptedRequest = buildEncryptedRequest(payload);

  const response = await client.request({
    method: path === DEFAULT_STATUS_PATH ? 'get' : 'post',
    url: resolveUrlPath(path),
    headers: {
      Authorization: `Bearer ${auth.token}`,
      key: encryptedRequest.headers.key,
      iv: encryptedRequest.headers.iv,
      'Content-Type': 'application/json',
    },
    data: encryptedRequest.body,
  });

  return {
    auth,
    encryptedRequest,
    response: response.data,
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
  const result = await sendEncryptedRequest({
    path: DEFAULT_STATUS_PATH,
    payload,
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

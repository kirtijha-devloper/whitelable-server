const express = require('express');
const axios = require('axios');
const { encryptRequestBody } = require('../utils/sevenpayEncryption');
const { appendSevenpayTestLog } = require('../utils/sevenpayTestLogger');

const router = express.Router();

const DEFAULT_TIMEOUT_MS = 30000;

function getSevenpayConfig() {
  return {
    baseUrl: (process.env.SEVENPAY_BASE_URL || 'https://txnapi.sevenpay.in').replace(/\/+$/, ''),
    username: process.env.SEVENPAY_USERNAME || '',
    password: process.env.SEVENPAY_PASSWORD || '',
    orgId: process.env.SEVENPAY_ORG_ID || '',
    userId: process.env.SEVENPAY_USER_ID || '',
    timeoutMs: Number(process.env.SEVENPAY_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

function getHttpClient() {
  const config = getSevenpayConfig();
  return axios.create({
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Axios/1.8.4',
      'Accept-Encoding': 'identity',
    },
  });
}

function maskValue(value) {
  if (!value || typeof value !== 'string') return value || null;
  if (value.length <= 10) return '***';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function extractToken(responseData) {
  return responseData?.token
    || responseData?.accessToken
    || responseData?.access_token
    || responseData?.data?.token
    || responseData?.data?.accessToken
    || responseData?.data?.access_token
    || null;
}

function assertSevenpayConfig() {
  const config = getSevenpayConfig();
  const missing = [];

  if (!config.username) missing.push('SEVENPAY_USERNAME');
  if (!config.password) missing.push('SEVENPAY_PASSWORD');
  if (!config.orgId) missing.push('SEVENPAY_ORG_ID');
  if (!config.userId) missing.push('SEVENPAY_USER_ID');
  if (!process.env.SEVENPAY_PUBLIC_KEY_PATH) missing.push('SEVENPAY_PUBLIC_KEY_PATH');

  if (missing.length) {
    const error = new Error(`Missing Sevenpay config: ${missing.join(', ')}`);
    error.status = 500;
    throw error;
  }

  return config;
}

function buildErrorPayload(error, context, requestData) {
  const nestedErrors = Array.isArray(error?.errors)
    ? error.errors.map((nestedError) => ({
        message: nestedError?.message || null,
        code: nestedError?.code || null,
        errno: nestedError?.errno || null,
        syscall: nestedError?.syscall || null,
        address: nestedError?.address || null,
        port: nestedError?.port || null,
      }))
    : [];

  return {
    success: false,
    context,
    request: requestData,
    error: {
      message: error.message,
      status: error.response?.status || null,
      data: error.response?.data || null,
      code: error.code || null,
      errno: error.errno || null,
      syscall: error.syscall || null,
      address: error.address || null,
      port: error.port || null,
      stack: error.stack ? error.stack.split('\n').slice(0, 6) : null,
      nestedErrors,
    },
  };
}

async function writeSevenpayLog({ action, statusCode, elapsedMs, message, request, response, error }) {
  await appendSevenpayTestLog({
    timestamp: new Date().toISOString(),
    action,
    statusCode,
    elapsedMs,
    message,
    request,
    response,
    error,
  });
}

async function loginToSevenPay() {
  const config = assertSevenpayConfig();
  const client = getHttpClient();
  const requestBody = {
    userName: config.username,
    password: config.password,
    channelType: 'API',
  };

  const encrypted = encryptRequestBody(requestBody);

  const response = await client.post('/api/Account/GetToken/Login', JSON.stringify(encrypted.encryptedPayload), {
    headers: {
      key: encrypted.encryptedKey,
      iv: encrypted.encryptedIv,
      'Content-Type': 'application/json',
    },
  });

  return {
    requestBody,
    responseData: response.data,
    token: extractToken(response.data),
  };
}

router.get('/login', async (_req, res) => {
  const config = getSevenpayConfig();
  const startedAt = Date.now();
  const requestBody = {
    userName: config.username || null,
    password: maskValue(config.password),
    channelType: 'API',
  };

  const requestInfo = {
    method: 'POST',
    url: `${config.baseUrl}/api/Account/GetToken/Login`,
    body: requestBody,
  };

  try {
    const loginResult = await loginToSevenPay();
    const payload = {
      success: true,
      route: '/api/test/sevenpay/login',
      request: requestInfo,
      response: loginResult.responseData,
      derived: {
        tokenFound: Boolean(loginResult.token),
        maskedToken: maskValue(loginResult.token),
      },
    };

    await writeSevenpayLog({
      action: 'login',
      statusCode: 200,
      elapsedMs: Date.now() - startedAt,
      message: 'SevenPay login test success',
      request: requestInfo,
      response: payload.response,
      error: null,
    });

    return res.status(200).json(payload);
  } catch (error) {
    const payload = buildErrorPayload(error, 'SevenPay login test', requestInfo);
    await writeSevenpayLog({
      action: 'login',
      statusCode: payload.error.status || 500,
      elapsedMs: Date.now() - startedAt,
      message: payload.error.message,
      request: requestInfo,
      response: payload.error.data,
      error: payload.error,
    });
    return res.status(500).json(payload);
  }
});

router.post('/initiate', async (req, res) => {
  const config = getSevenpayConfig();
  const startedAt = Date.now();
  const fallbackCrn = `TEST${Date.now()}`;
  const plainPayload = {
    orgId: config.orgId,
    userId: config.userId,
    paymentMode: req.body.paymentMode || 'IMPS',
    crn: req.body.crn || fallbackCrn,
    amount: req.body.amount || '10.00',
    receiverName: req.body.receiverName || 'TEST USER',
    ifsc: req.body.ifsc || 'SBIN0000001',
    accountNo: req.body.accountNo || '12345678901',
    clientIP: req.body.clientIP || req.ip || '127.0.0.1',
    refParam1: req.body.refParam1 || '',
    refParam2: req.body.refParam2 || '',
    refParam3: req.body.refParam3 || '',
  };

  try {
    const loginResult = await loginToSevenPay();
    if (!loginResult.token) {
      return res.status(502).json({
        success: false,
        route: '/api/test/sevenpay/initiate',
        message: 'SevenPay token missing in login response',
        loginResponse: loginResult.responseData,
      });
    }

    const encrypted = encryptRequestBody(plainPayload);
    const client = getHttpClient();

    const requestInfo = {
      method: 'POST',
      url: `${config.baseUrl}/api/Payout/initiatePayout`,
      headers: {
        Authorization: `Bearer ${maskValue(loginResult.token)}`,
        key: `${encrypted.encryptedKey.slice(0, 16)}...`,
        iv: `${encrypted.encryptedIv.slice(0, 16)}...`,
      },
      body: plainPayload,
      encryptedBodyPreview: `${encrypted.encryptedPayload.slice(0, 48)}...`,
    };

    const response = await client.request({
      method: 'post',
      url: '/api/Payout/initiatePayout',
      headers: {
        Authorization: `Bearer ${loginResult.token}`,
        key: encrypted.encryptedKey,
        iv: encrypted.encryptedIv,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify(encrypted.encryptedPayload),
    });

    const payload = {
      success: true,
      route: '/api/test/sevenpay/initiate',
      request: requestInfo,
      response: response.data,
      derived: {
        crn: plainPayload.crn,
      },
    };

    await writeSevenpayLog({
      action: 'initiate',
      statusCode: 200,
      elapsedMs: Date.now() - startedAt,
      message: 'SevenPay initiate test success',
      request: requestInfo,
      response: payload.response,
      error: null,
    });

    return res.status(200).json(payload);
  } catch (error) {
    const requestInfo = {
      method: 'POST',
      url: `${config.baseUrl}/api/Payout/initiatePayout`,
      body: plainPayload,
    };
    const payload = buildErrorPayload(error, 'SevenPay initiate test', requestInfo);
    await writeSevenpayLog({
      action: 'initiate',
      statusCode: payload.error.status || 500,
      elapsedMs: Date.now() - startedAt,
      message: payload.error.message,
      request: requestInfo,
      response: payload.error.data,
      error: payload.error,
    });
    return res.status(500).json(payload);
  }
});

router.get('/status', async (req, res) => {
  const config = getSevenpayConfig();
  const startedAt = Date.now();
  const plainPayload = {
    CRN: req.query.crn || req.query.CRN || '',
    paymentId: req.query.paymentId || '',
  };

  try {
    const loginResult = await loginToSevenPay();
    if (!loginResult.token) {
      return res.status(502).json({
        success: false,
        route: '/api/test/sevenpay/status',
        message: 'SevenPay token missing in login response',
        loginResponse: loginResult.responseData,
      });
    }

    const encrypted = encryptRequestBody(plainPayload);
    const client = getHttpClient();

    const requestInfo = {
      method: 'GET',
      url: `${config.baseUrl}/api/PayOut/getPayoutStatus`,
      headers: {
        Authorization: `Bearer ${maskValue(loginResult.token)}`,
        key: `${encrypted.encryptedKey.slice(0, 16)}...`,
        iv: `${encrypted.encryptedIv.slice(0, 16)}...`,
      },
      body: plainPayload,
      encryptedBodyPreview: `${encrypted.encryptedPayload.slice(0, 48)}...`,
    };

    const response = await client.request({
      method: 'get',
      url: '/api/PayOut/getPayoutStatus',
      headers: {
        Authorization: `Bearer ${loginResult.token}`,
        key: encrypted.encryptedKey,
        iv: encrypted.encryptedIv,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify(encrypted.encryptedPayload),
    });

    const payload = {
      success: true,
      route: '/api/test/sevenpay/status',
      request: requestInfo,
      response: response.data,
    };

    await writeSevenpayLog({
      action: 'status',
      statusCode: 200,
      elapsedMs: Date.now() - startedAt,
      message: 'SevenPay status test success',
      request: requestInfo,
      response: payload.response,
      error: null,
    });

    return res.status(200).json(payload);
  } catch (error) {
    const requestInfo = {
      method: 'GET',
      url: `${config.baseUrl}/api/PayOut/getPayoutStatus`,
      body: plainPayload,
    };
    const payload = buildErrorPayload(error, 'SevenPay status test', requestInfo);
    await writeSevenpayLog({
      action: 'status',
      statusCode: payload.error.status || 500,
      elapsedMs: Date.now() - startedAt,
      message: payload.error.message,
      request: requestInfo,
      response: payload.error.data,
      error: payload.error,
    });
    return res.status(500).json(payload);
  }
});

module.exports = router;

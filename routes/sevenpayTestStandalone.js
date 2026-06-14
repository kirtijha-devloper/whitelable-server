const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const SEVENPAY_CONFIG = {
  baseUrl: 'https://txnapi.sevenpay.in',
  username: 'RT10547',
  password: 'Tushar@10',
  orgId: 547,
  userId: 763,
  publicKeyPath: path.resolve(__dirname, '../keys/PublicKey_SBI_P_2025.cer'),
  timeoutMs: 30000,
};

function getHttpClient() {
  return axios.create({
    baseURL: SEVENPAY_CONFIG.baseUrl,
    timeout: SEVENPAY_CONFIG.timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Axios/1.8.4',
      'Accept-Encoding': 'identity', // Prevents automatic compression which can sometimes cause stream aborts
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

function loadPublicKey() {
  if (!fs.existsSync(SEVENPAY_CONFIG.publicKeyPath)) {
    throw new Error(`SevenPay public key file not found at ${SEVENPAY_CONFIG.publicKeyPath}`);
  }

  return fs.readFileSync(SEVENPAY_CONFIG.publicKeyPath, 'utf8');
}

function encryptPayload(payload) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const serializedPayload = JSON.stringify(payload);

  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  let encryptedPayload = cipher.update(serializedPayload, 'utf8', 'base64');
  encryptedPayload += cipher.final('base64');

  const publicKey = loadPublicKey();
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
    encryptedPayload,
    encryptedKey,
    encryptedIv,
  };
}

function buildErrorPayload(error, context, requestData) {
  return {
    success: false,
    context,
    request: requestData,
    error: {
      message: error.message,
      status: error.response?.status || null,
      data: error.response?.data || null,
    },
  };
}

function logSevenPayTest(label, data) {
  try {
    const ts = new Date().toISOString();
    const logDir = path.resolve(__dirname, '../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'sevenpay-test.log');
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.appendFileSync(logFile, `[${ts}] ${label}\n${body}\n\n`);
  } catch (_) { /* ignore log failures */ }
}

async function loginToSevenPay() {
  const client = getHttpClient();
  const requestBody = {
    userName: SEVENPAY_CONFIG.username,
    password: SEVENPAY_CONFIG.password,
    channelType: 'API',
  };

  logSevenPayTest('LOGIN_REQUEST', {
    url: '/api/Account/GetToken/Login',
    payload: { ...requestBody, password: maskValue(requestBody.password) }
  });

  try {
    const response = await client.post('/api/Account/GetToken/Login', requestBody);

    logSevenPayTest('LOGIN_RESPONSE_SUCCESS', {
      status: response.status,
      data: response.data
    });

    return {
      requestBody,
      responseData: response.data,
      token: extractToken(response.data),
    };
  } catch (error) {
    logSevenPayTest('LOGIN_RESPONSE_ERROR', {
      message: error.message,
      code: error.code, // Useful to see if it's ECONNRESET, ETIMEDOUT, etc.
      stack: error.stack,
      status: error.response?.status,
      data: error.response?.data
    });
    throw error;
  }
}

router.get('/login', async (_req, res) => {
  const requestInfo = {
    method: 'POST',
    url: `${SEVENPAY_CONFIG.baseUrl}/api/Account/GetToken/Login`,
    body: {
      userName: SEVENPAY_CONFIG.username,
      password: maskValue(SEVENPAY_CONFIG.password),
      channelType: 'API',
    },
  };

  try {
    const loginResult = await loginToSevenPay();

    return res.status(200).json({
      success: true,
      route: '/api/test/sevenpay/login',
      request: requestInfo,
      response: loginResult.responseData,
      derived: {
        tokenFound: Boolean(loginResult.token),
        maskedToken: maskValue(loginResult.token),
      },
    });
  } catch (error) {
    return res.status(500).json(buildErrorPayload(error, 'SevenPay login test', requestInfo));
  }
});

router.post('/initiate', async (req, res) => {
  const fallbackCrn = `TEST${Date.now()}`;
  const plainPayload = {
    orgId: SEVENPAY_CONFIG.orgId,
    userId: SEVENPAY_CONFIG.userId,
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

    const encrypted = encryptPayload(plainPayload);
    const client = getHttpClient();

    const requestInfo = {
      method: 'POST',
      url: `${SEVENPAY_CONFIG.baseUrl}/api/Payout/initiatePayout`,
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

    return res.status(200).json({
      success: true,
      route: '/api/test/sevenpay/initiate',
      request: requestInfo,
      response: response.data,
      derived: {
        crn: plainPayload.crn,
      },
    });
  } catch (error) {
    return res.status(500).json(buildErrorPayload(error, 'SevenPay initiate test', {
      method: 'POST',
      url: `${SEVENPAY_CONFIG.baseUrl}/api/Payout/initiatePayout`,
      body: plainPayload,
    }));
  }
});

router.get('/status', async (req, res) => {
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

    const encrypted = encryptPayload(plainPayload);
    const client = getHttpClient();

    const requestInfo = {
      method: 'GET',
      url: `${SEVENPAY_CONFIG.baseUrl}/api/PayOut/getPayoutStatus`,
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

    return res.status(200).json({
      success: true,
      route: '/api/test/sevenpay/status',
      request: requestInfo,
      response: response.data,
    });
  } catch (error) {
    return res.status(500).json(buildErrorPayload(error, 'SevenPay status test', {
      method: 'GET',
      url: `${SEVENPAY_CONFIG.baseUrl}/api/PayOut/getPayoutStatus`,
      body: plainPayload,
    }));
  }
});

module.exports = router;

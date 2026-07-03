const express = require('express');
const axios = require('axios');
const { encryptJsonPayload, decryptAesFromBase64 } = require('../utils/sevenpayEncryption');
const { appendSevenpayTestLog } = require('../utils/sevenpayTestLogger');
const PayoutTransaction = require('../models/PayoutTransaction');
const { Op } = require('sequelize');

const router = express.Router();

const DEFAULT_TIMEOUT_MS = 30000;
const SEVENPAY_TEST_MAX_AMOUNT = 100000;

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
  const plainRequestBody = {
    userName: config.username,
    password: config.password,
    channelType: 'API',
  };

  const encrypted = encryptJsonPayload(plainRequestBody);

  let response;
  try {
    response = await client.post('/api/Account/GetToken/Login', encrypted.encryptedPayload, {
      headers: {
        key: encrypted.encryptedKey,
        iv: encrypted.encryptedIv,
        'Content-Type': 'application/json',
        'x-request-channel': 'Web'
      },
      transformRequest: [(data) => data],
      responseType: 'text',
      transformResponse: [(data) => data]
    });
  } catch (error) {
    if (error.response?.data) {
      try {
        const decryptedErrorText = decryptAesFromBase64(error.response.data, encrypted.aesKey, encrypted.iv);
        try {
          error.response.data = JSON.parse(decryptedErrorText);
        } catch {
          error.response.data = decryptedErrorText;
        }
      } catch (decryptErr) {
        console.error("Failed to decrypt error response in loginToSevenPay:", decryptErr.message);
      }
    }
    throw error;
  }

  const decryptedText = decryptAesFromBase64(response.data, encrypted.aesKey, encrypted.iv);
  let responseData;
  try {
    responseData = JSON.parse(decryptedText);
  } catch (err) {
    responseData = decryptedText;
  }

  return {
    requestBody: plainRequestBody,
    responseData,
    token: extractToken(responseData),
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
  const requestedAmount = Number(req.body.amount || '10.00');

  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > SEVENPAY_TEST_MAX_AMOUNT) {
    return res.status(400).json({
      success: false,
      route: '/api/test/sevenpay/initiate',
      message: `SevenPay payout amount must be between 0 and ₹${SEVENPAY_TEST_MAX_AMOUNT}.`,
    });
  }

  const plainPayload = {
    orgId: config.orgId,
    userId: config.userId,
    paymentMode: req.body.paymentMode || 'IMPS',
    crn: req.body.crn || fallbackCrn,
    amount: String(requestedAmount.toFixed(2)),
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

    const encrypted = encryptJsonPayload(plainPayload);
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

    let rawResponse;
    try {
      const response = await client.request({
        method: 'post',
        url: '/api/Payout/initiatePayout',
        headers: {
          Authorization: `Bearer ${loginResult.token}`,
          key: encrypted.encryptedKey,
          iv: encrypted.encryptedIv,
          'Content-Type': 'application/json',
        },
        data: encrypted.encryptedPayload,
        transformRequest: [(data) => data],
        responseType: 'text',
        transformResponse: [(data) => data]
      });
      const decryptedText = decryptAesFromBase64(response.data, encrypted.aesKey, encrypted.iv);
      try {
        rawResponse = JSON.parse(decryptedText);
      } catch {
        rawResponse = decryptedText;
      }
    } catch (apiError) {
      if (apiError.response?.data) {
        try {
          const decryptedErrorText = decryptAesFromBase64(apiError.response.data, encrypted.aesKey, encrypted.iv);
          try {
            apiError.response.data = JSON.parse(decryptedErrorText);
          } catch {
            apiError.response.data = decryptedErrorText;
          }
        } catch (decryptErr) {}
      }
      throw apiError;
    }

    const payload = {
      success: true,
      route: '/api/test/sevenpay/initiate',
      request: requestInfo,
      response: rawResponse,
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
  const plainPayload = {};
  if (req.query.crn || req.query.CRN) plainPayload.crnId = req.query.crn || req.query.CRN;
  if (req.query.paymentId) plainPayload.paymentId = Number(req.query.paymentId);

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

    const encrypted = encryptJsonPayload(plainPayload);
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

    let rawResponse;
    try {
      const response = await client.request({
        method: 'get',
        url: '/api/PayOut/getPayoutStatus',
        headers: {
          Authorization: `Bearer ${loginResult.token}`,
          key: encrypted.encryptedKey,
          iv: encrypted.encryptedIv,
          'Content-Type': 'application/json',
        },
        params: plainPayload,
        transformRequest: [(data) => data],
        responseType: 'text',
        transformResponse: [(data) => data]
      });
      const decryptedText = decryptAesFromBase64(response.data, encrypted.aesKey, encrypted.iv);
      try {
        rawResponse = JSON.parse(decryptedText);
      } catch {
        rawResponse = decryptedText;
      }
    } catch (apiError) {
      if (apiError.response?.data) {
        try {
          const decryptedErrorText = decryptAesFromBase64(apiError.response.data, encrypted.aesKey, encrypted.iv);
          try {
            apiError.response.data = JSON.parse(decryptedErrorText);
          } catch {
            apiError.response.data = decryptedErrorText;
          }
        } catch (decryptErr) {}
      }
      throw apiError;
    }

    const payload = {
      success: true,
      route: '/api/test/sevenpay/status',
      request: requestInfo,
      response: rawResponse,
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

router.get('/debug/db', async (req, res) => {
  try {
    const { date } = req.query; // Format: YYYY-MM-DD
    
    let whereClause = {
      payout_provider: 'Sevenpay'
    };
    
    if (date) {
      // Assuming server timezone is Asia/Kolkata but DB stores in UTC,
      // it's safest to just do a broad substring match on the date string if timezone is an issue, 
      // but let's do a standard date range.
      const startDate = new Date(`${date}T00:00:00.000Z`);
      const endDate = new Date(`${date}T23:59:59.999Z`);
      whereClause.createdAt = {
        [Op.between]: [startDate, endDate]
      };
    }
    
    const transactions = await PayoutTransaction.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: 100 // Prevent crashing if there's thousands
    });
    
    const parsedTransactions = transactions.map(tx => {
      let parsedData = tx.data;
      try {
        if (typeof tx.data === 'string') {
          parsedData = JSON.parse(tx.data);
        }
      } catch(e) {}
      
      return {
        id: tx.id,
        merchant_id: tx.merchant_id,
        reference_id: tx.reference_id,
        amount: tx.amount,
        status: tx.status,
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt,
        data: parsedData
      };
    });
    
    return res.status(200).json({
      success: true,
      count: parsedTransactions.length,
      data: parsedTransactions
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;

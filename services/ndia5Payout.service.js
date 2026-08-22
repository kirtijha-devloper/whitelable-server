/**
 * =========================================================================
 * NDIA5 PAYOUT SERVICE
 * =========================================================================
 * Modular service for interacting with the NDIA5 Payout Gateway.
 * Handles Login/Auth, Initiate Payout, Payout Status Check, and Balance Check.
 * 
 * Logs ALL request and response parameters for all 4 APIs to `logs/india5.log`.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Log file path: POS-SERVER/logs/india5.log
const LOG_FILE = path.join(__dirname, '../logs/india5.log');

/**
 * Appends detailed structured logs to logs/india5.log
 * @param {string} apiName - Name of the API operation (e.g. LOGIN, BALANCE_CHECK)
 * @param {object} logData - Request & Response payload details
 */
function india5Log(apiName, logData) {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      api: apiName,
      ...logData,
    };

    const line = `[${timestamp}] [${apiName}] ${JSON.stringify(logEntry, null, 2)}\n--------------------------------------------------------------------------------\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch (err) {
    console.error('[NDIA5 Log Error] Failed to write to india5.log:', err.message);
  }
}

/**
 * Returns configuration values from environment variables with fallback
 */
function getConfig() {
  return {
    baseURL: (process.env.NDIA5_BASE_URL || 'https://api.uat.ndia5.com').replace(/\/+$/, ''),
    username: process.env.NDIA5_USERNAME || 'ND0144',
    password: process.env.NDIA5_PASSWORD || 'C5gBq@IcEO',
    salt: process.env.NDIA5_SALT || 'BE6EEBC412838688D9B8394D53D29043',
    timeout: Number(process.env.NDIA5_TIMEOUT_MS || 30000),
  };
}

// In-memory token cache to reuse Bearer token during execution
const tokenCache = {
  token: null,
  expiresAt: 0,
};

/**
 * Helper to generate IST ISO Timestamp string (+05:30) required by NDIA5 headers
 */
function getIstTimestamp() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  const year = istTime.getUTCFullYear();
  const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istTime.getUTCDate()).padStart(2, '0');
  const hours = String(istTime.getUTCHours()).padStart(2, '0');
  const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(istTime.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+05:30`;
}

/**
 * Helper to normalize provider transaction status values
 */
function normalizeStatus(statusRaw) {
  if (!statusRaw) return 'PENDING';
  const val = String(statusRaw).trim().toUpperCase();
  if (['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PROCESSED', 'APPROVED'].includes(val)) {
    return 'SUCCESS';
  }
  if (['FAILED', 'FAILURE', 'REJECTED', 'DECLINED', 'CANCELLED', 'ERROR'].includes(val)) {
    return 'FAILED';
  }
  return 'PENDING';
}

/**
 * API 1: AUTHENTICATION (LOGIN)
 * Logs request & response details to india5.log
 */
async function login(forceRefresh = false) {
  const config = getConfig();

  // Return cached token if still valid and not forcing refresh
  if (!forceRefresh && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const endpoint = `${config.baseURL}/auth/merchant/login`;
  const payload = {
    username: config.username,
    password: config.password,
  };

  const reqLog = {
    endpoint,
    method: 'POST',
    requestHeaders: { 'Content-Type': 'application/json' },
    requestBody: { username: config.username, password: '***' }, // Mask sensitive password in logs
  };

  try {
    const response = await axios.post(endpoint, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: config.timeout,
    });

    const data = response.data;
    const token = data?.data?.token;

    india5Log('LOGIN', {
      ...reqLog,
      responseStatus: response.status,
      responseBody: data,
      success: !!token,
    });

    if (token) {
      tokenCache.token = token;
      // Set expiration buffer to 23 hours (JWT default lifetime is usually 24h)
      tokenCache.expiresAt = Date.now() + 23 * 60 * 60 * 1000;
      return token;
    } else {
      throw new Error(data?.meta?.message || 'Failed to retrieve access token from NDIA5');
    }
  } catch (error) {
    const errorResponse = error.response ? { status: error.response.status, data: error.response.data } : null;
    india5Log('LOGIN', {
      ...reqLog,
      error: error.message,
      errorResponse,
      success: false,
    });
    throw new Error(`NDIA5 Login Failed: ${error.message}`);
  }
}

/**
 * API 4: BALANCE CHECK
 * Logs request & response details to india5.log
 */
async function getBalance(params = {}) {
  const config = getConfig();
  let token = await login();
  const endpoint = `${config.baseURL}/transaction/getBalance`;

  let attempts = 0;
  while (attempts < 2) {
    const timestamp = getIstTimestamp();
    const payload = {
      accountNumber: params.accountNumber || '103712250034',
      ifsc: params.ifsc || 'SMCB0001037',
    };

    const reqLog = {
      endpoint,
      method: 'POST',
      requestHeaders: {
        Authorization: 'Bearer [HIDDEN]',
        timestamp,
        'Content-Type': 'application/json',
      },
      requestBody: payload,
    };

    try {
      const response = await axios.post(endpoint, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          timestamp,
          'Content-Type': 'application/json',
        },
        timeout: config.timeout,
      });

      india5Log('BALANCE_CHECK', {
        ...reqLog,
        responseStatus: response.status,
        responseBody: response.data,
        success: true,
      });

      return {
        success: true,
        rawResponse: response.data,
        balance: response.data,
      };
    } catch (error) {
      const errorStatus = error.response ? error.response.status : null;
      if (errorStatus === 401 && attempts === 0) {
        attempts++;
        india5Log('BALANCE_CHECK_401_RETRY', {
          message: 'Received 401 Unauthorized from NDIA5. Requesting new login token and retrying...',
          error: error.message,
        });
        token = await login(true); // force fresh login
        continue;
      }

      const errorResponse = error.response ? { status: error.response.status, data: error.response.data } : null;
      india5Log('BALANCE_CHECK', {
        ...reqLog,
        error: error.message,
        errorResponse,
        success: false,
      });
      throw new Error(`NDIA5 Get Balance Failed: ${error.message}`);
    }
  }
}

/**
 * API 2: INITIATE PAYOUT
 * Calculates HMAC-SHA256 Base64 signature and logs request & response details to india5.log
 */
async function initiatePayout(params) {
  const config = getConfig();
  let token = await login();
  const endpoint = `${config.baseURL}/transaction/initiate`;

  const {
    merchantReferenceId,
    amount,
    channel = 'IMPS',
    payeeName = 'Beneficiary',
    bankAccount,
    ifsc,
    customerMobile = '9876543210',
    customerName = 'Customer',
    webhookUrl = 'https://pos.abheepay.com/api/payout/ndia5/callback',
    latitude = '12.9716',
    longitude = '77.5946',
  } = params;

  if (!merchantReferenceId || !amount || !bankAccount || !ifsc) {
    throw new Error('Missing required payout parameters: merchantReferenceId, amount, bankAccount, ifsc');
  }

  const payload = {
    merchant_reference_id: merchantReferenceId,
    amount: Number(amount),
    currency: 'INR',
    service: 'PAYOUT',
    service_details: {
      payout: {
        channel,
        payee_details: {
          payee_name: payeeName,
          payee_bank_account_no: bankAccount,
          payee_bank_ifsc: ifsc,
        },
      },
    },
    customer_details: {
      customer_name: customerName,
      customer_mobile: customerMobile,
    },
    geo_location: {
      latitude,
      longitude,
    },
    webhook_url: webhookUrl,
  };

  let attempts = 0;
  while (attempts < 2) {
    const timestamp = getIstTimestamp();

    // Format amount strictly for NDIA5 signature generation (append '.0' if integer format)
    const numAmount = Number(amount);
    const sigAmount = Number.isInteger(numAmount) ? `${numAmount}.0` : `${numAmount}`;

    // Signature raw string: "<AMOUNT>.0|PAYOUT|<merchant_ref_id>|<account_no>"
    const rawString = `${sigAmount}|PAYOUT|${merchantReferenceId}|${bankAccount}`;

    // Calculate HMAC-SHA256 Base64 signature
    const signature = crypto
      .createHmac('sha256', config.salt)
      .update(rawString)
      .digest('base64');

    const reqLog = {
      endpoint,
      method: 'POST',
      requestHeaders: {
        Authorization: 'Bearer [HIDDEN]',
        timestamp,
        signature,
        'Content-Type': 'application/json',
      },
      rawSignatureDataString: rawString,
      requestBody: payload,
    };

    try {
      const response = await axios.post(endpoint, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          timestamp,
          signature,
          'Content-Type': 'application/json',
        },
        timeout: config.timeout,
      });

      const data = response.data;
      const responseStatus = normalizeStatus(data?.data?.status);

      india5Log('INITIATE_PAYOUT', {
        ...reqLog,
        responseStatus: response.status,
        responseBody: data,
        normalizedStatus: responseStatus,
        success: true,
      });

      return {
        success: true,
        transactionId: data?.data?.transaction_id || data?.data?.transactionId || null,
        merchantReferenceId: data?.data?.merchant_reference_id || data?.data?.merchantReferenceId || merchantReferenceId,
        status: responseStatus,
        rawStatus: data?.data?.status || 'PENDING',
        serviceCharge: data?.data?.service_charge ?? data?.data?.serviceCharge ?? 0,
        createdAt: data?.data?.created_at || null,
        rawResponse: data,
      };
    } catch (error) {
      const errorStatus = error.response ? error.response.status : null;
      if (errorStatus === 401 && attempts === 0) {
        attempts++;
        india5Log('INITIATE_PAYOUT_401_RETRY', {
          message: 'Received 401 Unauthorized from NDIA5. Requesting new login token and retrying...',
          error: error.message,
        });
        token = await login(true); // force fresh login
        continue;
      }

      const errorResponse = error.response ? { status: error.response.status, data: error.response.data } : null;
      india5Log('INITIATE_PAYOUT', {
        ...reqLog,
        error: error.message,
        errorResponse,
        success: false,
      });
      const customErr = new Error(`NDIA5 Payout Initiation Failed: ${error.message}`);
      if (errorResponse) {
        customErr.errorResponse = errorResponse;
      }
      throw customErr;
    }
  }
}

/**
 * API 3: STATUS CHECK
 * Queries payout transaction status and logs request & response details to india5.log
 */
async function getPayoutStatus(merchantReferenceId) {
  if (!merchantReferenceId) {
    throw new Error('merchantReferenceId is required for status check');
  }

  const config = getConfig();
  let token = await login();
  const endpoint = `${config.baseURL}/transaction/check/payoutStatus/${merchantReferenceId}`;

  let attempts = 0;
  while (attempts < 2) {
    const timestamp = getIstTimestamp();

    const reqLog = {
      endpoint,
      method: 'GET',
      requestHeaders: {
        Authorization: 'Bearer [HIDDEN]',
        timestamp,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      merchantReferenceId,
    };

    try {
      const response = await axios.get(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
          timestamp,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: config.timeout,
      });

      const data = response.data;
      const responseStatus = normalizeStatus(data?.data?.status);

      india5Log('STATUS_CHECK', {
        ...reqLog,
        responseStatus: response.status,
        responseBody: data,
        normalizedStatus: responseStatus,
        success: true,
      });

      return {
        success: true,
        transactionId: data?.data?.transactionId || data?.data?.transaction_id || null,
        merchantReferenceId: data?.data?.merchantReferenceId || data?.data?.merchant_reference_id || merchantReferenceId,
        status: responseStatus,
        rawStatus: data?.data?.status || 'PENDING',
        serviceCharge: data?.data?.serviceCharge ?? data?.data?.service_charge ?? 0,
        rawResponse: data,
      };
    } catch (error) {
      const errorStatus = error.response ? error.response.status : null;
      if (errorStatus === 401 && attempts === 0) {
        attempts++;
        india5Log('STATUS_CHECK_401_RETRY', {
          message: 'Received 401 Unauthorized from NDIA5. Requesting new login token and retrying...',
          error: error.message,
        });
        token = await login(true); // force fresh login
        continue;
      }

      const errorResponse = error.response ? { status: error.response.status, data: error.response.data } : null;
      india5Log('STATUS_CHECK', {
        ...reqLog,
        error: error.message,
        errorResponse,
        success: false,
      });
      throw new Error(`NDIA5 Status Check Failed: ${error.message}`);
    }
  }
}

module.exports = {
  login,
  getBalance,
  initiatePayout,
  getPayoutStatus,
  normalizeStatus,
  india5Log,
};

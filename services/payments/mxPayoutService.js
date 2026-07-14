const axios = require('axios');
const fs = require('fs');
const path = require('path');

const MX_LOG_FILE = path.join(__dirname, '../../logs/mx-payout.log');

try {
  const logDir = path.dirname(MX_LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (err) {
  console.error('Failed to ensure MX log directory exists:', err);
}

function mxLog(level, message, data) {
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
    fs.appendFileSync(MX_LOG_FILE, line);
  } catch (_) { /* never crash due to logging */ }
}

const getHeaders = () => {
  const token = process.env.MX_PAYOUT_TOKEN || '';
  if (!token) {
    mxLog('WARNING', 'MX_PAYOUT_TOKEN is not configured in environment variables');
  }
  return {
    'Content-Type': 'application/json',
    'X-payout-token': token
  };
};

const getBaseUrl = () => {
  return (process.env.MX_BASE_URL || 'https://merorecharge.com').replace(/\/+$/, '');
};

const request = async ({ method, endpoint, data = {} }) => {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  const headers = getHeaders();

  mxLog('INFO', `MX API Request [${method} ${endpoint}]`, { data });

  try {
    const config = {
      method,
      url,
      headers,
      data: Object.keys(data).length > 0 ? data : undefined
    };

    const response = await axios.request(config);
    mxLog('SUCCESS', `MX API Response [${method} ${endpoint}]`, response.data);
    return response.data;
  } catch (error) {
    const responseErrorData = error?.response?.data || error.message;
    mxLog('ERROR', `MX Service Error [${endpoint}]`, responseErrorData);
    throw responseErrorData || { message: 'Something went wrong!' };
  }
};

/**
 * Normalize raw status into SUCCESS, FAILED, or PENDING
 */
function normalizeStatus(statusRaw) {
  if (!statusRaw) return 'PENDING';
  const status = String(statusRaw).trim().toUpperCase();
  if (['SUCCESS', 'COMPLETED', 'SUCCESSFUL'].includes(status)) return 'SUCCESS';
  if (['FAILED', 'FAILURE', 'REJECTED', 'CANCELLED'].includes(status)) return 'FAILED';
  if (['PENDING', 'PROCESSING', 'IN_PROGRESS', 'INITIATED'].includes(status)) return 'PENDING';
  return 'PENDING';
}

// Submit direct payout request
const initiatePayout = async (payload) => {
  const transactionPin = process.env.MX_TRANSACTION_PIN || '';
  if (!transactionPin) {
    mxLog('WARNING', 'MX_TRANSACTION_PIN is not configured in environment variables');
  }

  const mxPayload = {
    ...payload,
    transactionPin
  };

  const responseData = await request({
    method: 'POST',
    endpoint: '/api/payout-direct',
    data: mxPayload
  });

  return {
    success: responseData.success === true,
    status: normalizeStatus(responseData.status || (responseData.success ? 'PENDING' : 'FAILED')),
    message: responseData.message || '',
    requestId: responseData.requestId || responseData.payout?.requestId || null,
    payoutId: responseData.payout?.payoutId || null,
    rawResponse: responseData
  };
};

// Check payout status
const getPayoutStatus = async (requestId) => {
  const responseData = await request({
    method: 'POST',
    endpoint: '/api/payout-status',
    data: { requestId }
  });

  return {
    success: responseData.success === true,
    status: normalizeStatus(responseData.status || (responseData.success ? 'SUCCESS' : 'FAILED')),
    message: responseData.message || '',
    requestId: responseData.requestId || responseData.payout?.requestId || null,
    payoutId: responseData.payout?.payoutId || null,
    rawResponse: responseData
  };
};

module.exports = {
  initiatePayout,
  getPayoutStatus,
  normalizeStatus
};

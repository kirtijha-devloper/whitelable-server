const axios = require('axios');
const net = require('net');
const { appendPineLabsTestLog } = require('../utils/pinelabsTestLogger');

const ACTION_CONFIG = {
  upload: {
    envPathKey: 'PINELABS_UAT_UPLOAD_PATH',
    fallbackPath: '/api/UploadTransaction',
  },
  status: {
    envPathKey: 'PINELABS_UAT_STATUS_PATH',
    fallbackPath: '/api/GetStatus',
  },
  cancel: {
    envPathKey: 'PINELABS_UAT_CANCEL_PATH',
    fallbackPath: '/api/CancelTransaction',
  },
};

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function trimLeadingSlash(value) {
  return String(value || '').replace(/^\/+/, '');
}

function maskSecrets(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }

  if (value.length <= 8) {
    return '***';
  }

  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function maskHeaders(headers) {
  const sensitiveKeys = [
    'authorization',
    'x-api-key',
    'api-key',
    'apikey',
    'client-secret',
    'password',
    'securitytoken',
  ];
  const masked = {};

  for (const [key, value] of Object.entries(headers || {})) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      masked[key] = maskSecrets(value);
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

function parseJsonEnv(key) {
  const rawValue = process.env[key];
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    const envError = new Error(`Invalid JSON in ${key}`);
    envError.statusCode = 500;
    throw envError;
  }
}

function getConfig(action) {
  const actionConfig = ACTION_CONFIG[action];
  if (!actionConfig) {
    const error = new Error(`Unsupported Pine Labs test action: ${action}`);
    error.statusCode = 400;
    throw error;
  }

  const baseUrl = trimTrailingSlash(process.env.PINELABS_UAT_BASE_URL);
  if (!baseUrl) {
    const error = new Error('Missing PINELABS_UAT_BASE_URL in .env');
    error.statusCode = 500;
    throw error;
  }

  const routePath = process.env[actionConfig.envPathKey] || actionConfig.fallbackPath;
  const timeoutMs = Number(process.env.PINELABS_UAT_TIMEOUT_MS) || 30000;
  const defaultHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...parseJsonEnv('PINELABS_UAT_HEADERS'),
  };

  if (process.env.PINELABS_UAT_MERCHANT_ID) {
    defaultHeaders.MerchantId = process.env.PINELABS_UAT_MERCHANT_ID;
  }

  if (process.env.PINELABS_UAT_SECURITY_TOKEN) {
    defaultHeaders.SecurityToken = process.env.PINELABS_UAT_SECURITY_TOKEN;
  }

  if (process.env.PINELABS_UAT_CLIENT_ID) {
    defaultHeaders.ClientID = process.env.PINELABS_UAT_CLIENT_ID;
  }

  if (process.env.PINELABS_UAT_STORE_ID) {
    defaultHeaders.StoreID = process.env.PINELABS_UAT_STORE_ID;
  }

  if (process.env.PINELABS_UAT_DEVICE_NUMBER) {
    defaultHeaders.DeviceNumber = process.env.PINELABS_UAT_DEVICE_NUMBER;
  }

  if (process.env.PINELABS_UAT_AUTH_TOKEN) {
    defaultHeaders.Authorization = process.env.PINELABS_UAT_AUTH_TOKEN;
  }

  if (process.env.PINELABS_UAT_API_KEY) {
    defaultHeaders['X-API-KEY'] = process.env.PINELABS_UAT_API_KEY;
  }

  return {
    action,
    baseUrl,
    path: `/${trimLeadingSlash(routePath)}`,
    timeoutMs,
    headers: defaultHeaders,
  };
}

function withDefaultCredentials(body) {
  return {
    ...body,
    MerchantID: body.MerchantID || process.env.PINELABS_UAT_MERCHANT_ID || '',
    SecurityToken: body.SecurityToken || process.env.PINELABS_UAT_SECURITY_TOKEN || '',
    ClientId: body.ClientId || process.env.PINELABS_UAT_CLIENT_ID || '',
    StoreId: body.StoreId || process.env.PINELABS_UAT_STORE_ID || '',
  };
}

function buildRequestBody(action, requestBody) {
  const bodyWithCredentials = withDefaultCredentials(requestBody || {});

  if (action === 'status' || action === 'cancel') {
    return {
      PlutusTransactionReferenceID: bodyWithCredentials.PlutusTransactionReferenceID,
      MerchantID: bodyWithCredentials.MerchantID,
      SecurityToken: bodyWithCredentials.SecurityToken,
    };
  }

  return bodyWithCredentials;
}

function buildLogEntry({ action, requestConfig, responseStatus, responseData, errorMessage }) {
  return {
    timestamp: new Date().toISOString(),
    action,
    request: requestConfig,
    response: responseData,
    statusCode: responseStatus,
    errorMessage: errorMessage || null,
  };
}

function extractNestedErrors(error) {
  if (!Array.isArray(error?.errors)) {
    return [];
  }

  return error.errors.map((nestedError) => ({
    message: nestedError?.message || null,
    code: nestedError?.code || null,
    errno: nestedError?.errno || null,
    syscall: nestedError?.syscall || null,
    address: nestedError?.address || null,
    port: nestedError?.port || null,
  }));
}

function serializeAxiosError(error) {
  return {
    message: error?.message || 'Unknown Pine Labs request failure',
    name: error?.name || null,
    code: error?.code || null,
    errno: error?.errno || null,
    syscall: error?.syscall || null,
    address: error?.address || null,
    port: error?.port || null,
    timeoutMs: error?.config?.timeout || null,
    nestedErrors: extractNestedErrors(error),
  };
}

async function callPineLabs(action, requestBody) {
  const config = getConfig(action);
  const client = axios.create({
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
  });
  const finalRequestBody = buildRequestBody(action, requestBody);

  const requestConfig = {
    method: 'POST',
    url: `${config.baseUrl}${config.path}`,
    headers: maskHeaders(config.headers),
    body: finalRequestBody,
  };

  try {
    const response = await client.post(config.path, finalRequestBody, {
      headers: config.headers,
    });

    const payload = {
      success: true,
      action,
      timestamp: new Date().toISOString(),
      request: requestConfig,
      response: response.data,
      statusCode: response.status,
    };

    await appendPineLabsTestLog(buildLogEntry({
      action,
      requestConfig,
      responseStatus: response.status,
      responseData: response.data,
    }));

    return {
      httpStatus: response.status,
      payload,
    };
  } catch (error) {
    const statusCode = error.response?.status || error.statusCode || 500;
    const errorDetails = serializeAxiosError(error);
    const responseData = error.response?.data || {
      message: errorDetails.message,
      error: errorDetails,
    };

    const payload = {
      success: false,
      action,
      timestamp: new Date().toISOString(),
      request: requestConfig,
      response: responseData,
      statusCode,
      error: {
        ...errorDetails,
      },
    };

    await appendPineLabsTestLog(buildLogEntry({
      action,
      requestConfig,
      responseStatus: statusCode,
      responseData,
      errorMessage: errorDetails.message,
    }));

    return {
      httpStatus: statusCode,
      payload,
    };
  }
}

async function checkPineLabsHealth() {
  const config = getConfig('upload');
  const targetUrl = new URL(config.baseUrl);
  const host = targetUrl.hostname;
  const port = Number(targetUrl.port) || (targetUrl.protocol === 'https:' ? 443 : 80);
  const probeTimeoutMs = Math.min(config.timeoutMs, 5000);

  const connectivity = await new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(probeTimeoutMs);
    socket.once('connect', () => {
      finish({
        ok: true,
        message: `Connected to ${host}:${port}`,
      });
    });
    socket.once('timeout', () => {
      finish({
        ok: false,
        message: `Connection timed out after ${probeTimeoutMs}ms`,
        code: 'ETIMEDOUT',
      });
    });
    socket.once('error', (error) => {
      finish({
        ok: false,
        message: error.message || 'Socket connection failed',
        code: error.code || null,
        errno: error.errno || null,
        syscall: error.syscall || null,
        address: error.address || null,
        port: error.port || null,
      });
    });

    socket.connect(port, host);
  });

  const payload = {
    success: connectivity.ok,
    timestamp: new Date().toISOString(),
    config: {
      baseUrl: config.baseUrl,
      uploadPath: process.env.PINELABS_UAT_UPLOAD_PATH || ACTION_CONFIG.upload.fallbackPath,
      statusPath: process.env.PINELABS_UAT_STATUS_PATH || ACTION_CONFIG.status.fallbackPath,
      cancelPath: process.env.PINELABS_UAT_CANCEL_PATH || ACTION_CONFIG.cancel.fallbackPath,
      timeoutMs: config.timeoutMs,
      host,
      port,
    },
    connectivity,
  };

  await appendPineLabsTestLog({
    timestamp: payload.timestamp,
    action: 'health',
    request: {
      host,
      port,
      timeoutMs: probeTimeoutMs,
    },
    response: payload,
    statusCode: connectivity.ok ? 200 : 503,
    errorMessage: connectivity.ok ? null : connectivity.message,
  });

  return {
    httpStatus: connectivity.ok ? 200 : 503,
    payload,
  };
}

module.exports = {
  callPineLabs,
  checkPineLabsHealth,
};

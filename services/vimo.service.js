const axios = require('axios');
const { AppError } = require('../utils/errors');
const { decryptCipherText, encryptPlainText } = require('./crypto.service');
const { reservePayoutWindow } = require('./payout-guard.service');

const vimoBaseURL = process.env.VIMO_BASE_URL;
const vimoTimeoutMs = Number(process.env.VIMO_TIMEOUT_MS || 15000);
const vimoCredentials = {
  secretKey: process.env.VIMO_SECRET_KEY,
  saltKey: process.env.VIMO_SALT_KEY,
  encryptdecryptKey: process.env.VIMO_ENCRYPT_KEY,
  userId: process.env.VIMO_USER_ID,
};

if (!vimoBaseURL) {
  throw new Error('VIMO_BASE_URL is not configured');
}
if (!vimoCredentials.secretKey || !vimoCredentials.saltKey || !vimoCredentials.encryptdecryptKey || !vimoCredentials.userId) {
  throw new Error('Vimo credentials are not configured in env variables');
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
  const encryptedPayload = extractEncryptedPayload(bankResponse);
  const decryptedText = decryptCipherText(encryptedPayload);
  const parsedPayload = parseMaybeJson(decryptedText);

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
    const response = await vimoClient.post('/payoutapi/api/signature/authorizeuat', {}, {
      headers: {
        secretKey: vimoCredentials.secretKey,
        saltKey: vimoCredentials.saltKey,
        encryptdecryptKey: vimoCredentials.encryptdecryptKey,
        userId: vimoCredentials.userId,
      },
    });

    const authorizeResponse = normalizeAuthorizeResponse(response.data);
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
  return fetchEncryptedList('/masterapi/api/master/banklistuat', 'Bank list fetched successfully');
}

async function fetchPurposeList() {
  return fetchEncryptedList('/masterapi/api/master/purposelistuat', 'Purpose list fetched successfully');
}

async function fetchStateList() {
  return fetchEncryptedList('/masterapi/api/master/statelistuat', 'State list fetched successfully');
}

async function createPayout(payload) {
  validatePayoutPayload(payload);

  const payoutReservation = reservePayoutWindow(payload);

  try {
    const response = await executeAuthorizedRequest((token) =>
      vimoClient.post(
        '/payoutapi/api/payment/payoutsuat',
        { requestBody: encryptPlainText(JSON.stringify(payload)) },
        {
          headers: {
            ...buildAuthorizedHeaders(token),
            'Content-Type': 'application/json',
          },
        }
      )
    );

    const normalizedResponse = normalizeDecryptedEnvelope(response.data, 'Payout processed successfully');

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

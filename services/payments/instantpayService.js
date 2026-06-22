const axios = require('axios');
const path = require('path');
const fs = require('fs');
const https = require('https');

const INSTANTPAY_LOG_FILE = path.join(__dirname, '../../logs/instantpay.log');

function instantpayLog(level, message, data) {
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
    fs.appendFileSync(INSTANTPAY_LOG_FILE, line);
  } catch (_) { /* never crash due to log failure */ }
}

const getInstantPayHeaders = () => {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Ipay-Auth-Code': process.env.IPAY_AUTH_CODE,
    'X-Ipay-Client-Id': process.env.IPAY_CLIENT_ID,
    'X-Ipay-Client-Secret': process.env.IPAY_CLIENT_SECRET,
    'X-Ipay-Endpoint-Ip': process.env.IPAY_ENDPOINT_IP,
  };
};

const getInstantPayConfig = () => {
  const missing = [];
  if (!process.env.IPAY_AUTH_CODE) missing.push('IPAY_AUTH_CODE');
  if (!process.env.IPAY_CLIENT_ID) missing.push('IPAY_CLIENT_ID');
  if (!process.env.IPAY_CLIENT_SECRET) missing.push('IPAY_CLIENT_SECRET');
  if (!process.env.IPAY_ENDPOINT_IP) missing.push('IPAY_ENDPOINT_IP');

  if (missing.length > 0) {
    throw new Error(`Missing InstantPay Credentials in .env: ${missing.join(', ')}`);
  }

  return {
    baseUrl: 'https://api.instantpay.in',
    headers: getInstantPayHeaders(),
    timeout: 30000
  };
};

/**
 * Verify Bank Account (Penny Drop) or UPI ID via InstantPay
 * @param {Object} params
 * @param {string} params.name - Expected name of account holder
 * @param {string} params.accountNumber - Bank Account Number or UPI ID
 * @param {string} params.bankIfsc - IFSC code (use " " for UPI)
 * @param {string} [params.merchantId] - Used to generate externalRef
 */
async function verifyBankAccount({ name, accountNumber, bankIfsc, merchantId }) {
  try {
    const config = getInstantPayConfig();
    const externalRef = `BAV${Date.now()}${merchantId || ''}`;
    
    // Check if it's UPI or Bank Account based on IFSC
    const isUpi = !bankIfsc || bankIfsc.trim() === '';
    
    const payload = {
      payee: {
        accountNumber: accountNumber,
        bankIfsc: isUpi ? " " : bankIfsc
      },
      externalRef: externalRef,
      consent: "Y",
      latitude: "28.6139",  // Defaulting to a central India location as required by API
      longitude: "77.2090"
    };

    if (isUpi) {
      payload.isCached = "0"; // For UPI verifications
    } else {
      payload.payee.name = name || 'Customer'; // Name is required for Bank Penny Drop
      payload.pennyDrop = "YES";
    }

    instantpayLog('INFO', `Initiating Bank Account Verification for ${accountNumber}`, payload);

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.post(`${config.baseUrl}/identity/verifyBankAccount`, payload, {
      headers: config.headers,
      timeout: config.timeout,
      httpsAgent
    });

    instantpayLog('SUCCESS', `Bank Verification Response`, response.data);

    // Parse the InstantPay response format
    // A successful response usually has statuscode 'TXN' or 'IPI' and status like 'Transaction Successful'
    const statuscode = response.data?.statuscode;
    const isSuccess = statuscode === 'TXN' || statuscode === 'IPI' || statuscode === '200' || response.data?.status === 'Transaction Successful';

    if (isSuccess) {
       return {
         status: 'SUCCESS',
         name: response.data.data?.payee?.name || name,
         utr: response.data.data?.bankReferenceNo || null,
         rawResponse: response.data
       };
    } else {
      // It's a failure response
      return {
        status: 'FAILED',
        message: response.data?.status || 'Bank verification failed',
        rawResponse: response.data
      };
    }

  } catch (error) {
    const errorData = error.response?.data || error.message;
    instantpayLog('ERROR', `Bank Verification Error`, errorData);
    
    return {
      status: 'FAILED',
      message: error.response?.data?.status || error.message || 'Bank account verification failed',
      rawResponse: errorData
    };
  }
}

/**
 * Fetch list of supported banks
 */
async function fetchSupportedBanks() {
  try {
    const config = getInstantPayConfig();
    
    instantpayLog('INFO', 'Fetching Supported Banks');
    
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    
    const response = await axios.get(`${config.baseUrl}/identity/verifyBankAccount/banks`, {
      headers: config.headers,
      timeout: config.timeout,
      httpsAgent
    });

    instantpayLog('SUCCESS', 'Fetched Supported Banks successfully');
    
    return {
      status: 'SUCCESS',
      data: response.data
    };
  } catch (error) {
    const errorData = error.response?.data || error.message;
    instantpayLog('ERROR', 'Error fetching banks', errorData);
    
    return {
      status: 'FAILED',
      message: error.message,
      rawResponse: errorData
    };
  }
}

module.exports = {
  verifyBankAccount,
  fetchSupportedBanks
};

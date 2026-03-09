const axios = require('axios');
const { credxpay } = require('../config/config');

const client = axios.create({
  baseURL: credxpay.baseUrl,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': credxpay.apiKey
  },
  timeout: 15000
});

client.interceptors.request.use((config) => {
  console.log(`CredXPay Request ${config.method.toUpperCase()} ${config.url}`, { data: config.data, params: config.params });
  return config;
});

client.interceptors.response.use(
  (resp) => resp.data,
  (err) => {
    const msg = err.response ? err.response.data : err.message;
    console.error('CredXPay Service Error', msg);
    // rethrow so callers can handle
    throw err.response ? err.response.data : { message: err.message };
  }
);

// --------------------------------------------------
// Public API
// --------------------------------------------------

async function initiateTransaction(payload) {
  // expected to POST /api/initiate-transaction
  return client.post('/api/initiate-transaction', payload);
}

async function checkStatus(requestId) {
  return client.post('/api/status', { requestId });
  // adjust endpoint name as per real API docs
}

module.exports = {
  initiateTransaction,
  checkStatus
};
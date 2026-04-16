const axios = require('axios');

const stageBillAvenueApiClient = axios.create({
  baseURL: process.env.BILLAVENUE_API_URL || 'https://api.billavenue.com/billpay',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

module.exports = stageBillAvenueApiClient;

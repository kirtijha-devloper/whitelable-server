const axios = require('axios');

const stageBillAvenueApiClient = axios.create({
  baseURL: 'https://stgapi.billavenue.com/billpay',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

module.exports = stageBillAvenueApiClient;

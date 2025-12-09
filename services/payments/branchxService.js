const axios = require('axios');
const https = require('https');

const BASE_URL = 'https://10x.api.branchx.in';
const API_TOKEN = process.env.BRANCHX_API_TOKEN || '26890F644A9499B360EE656E9AFD5DB6';

// Get headers with API token
const getHeaders = () => ({
  'Content-Type': 'application/json',
  'apiToken': API_TOKEN
});

const request = async ({ method, endpoint, data = {}, params = {} }) => {
  try {
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: getHeaders(),
      data: Object.keys(data).length > 0 ? data : undefined,
      params: Object.keys(params).length > 0 ? params : undefined,
      httpsAgent
    };

    console.log(`BranchX API Request [${method} ${endpoint}]`, { data, params });

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`BranchX Service Error [${endpoint}]`, error?.response?.data || error.message);
    throw error.response?.data || { message: 'Something went wrong!' };
  }
};

// =================== API METHODS ===================

// Payout API
const payout = async (payload) => {
  return await request({ 
    method: 'POST', 
    endpoint: '/service/payout/v2', 
    data: payload 
  });
};

// Remitter KYC Input
const remitterKycInput = async (payload) => {
  return await request({ 
    method: 'POST', 
    endpoint: '/service/remitter/kyc/input', 
    data: payload 
  });
};

// Remitter KYC Verify
const remitterKycVerify = async (otp) => {
  return await request({ 
    method: 'GET', 
    endpoint: '/service/remitter/kyc/verify', 
    params: { otp } 
  });
};

// Bank Account Validation (Penny Drop)
const bankValidation = async (payload) => {
  return await request({ 
    method: 'POST', 
    endpoint: '/service/bank/validation/v2', 
    data: payload 
  });
};

// Status Check API
const statusCheck = async (requestId) => {
  return await request({ 
    method: 'POST', 
    endpoint: '/service/status_check/v2', 
    data: { requestId } 
  });
};

module.exports = {
  payout,
  remitterKycInput,
  remitterKycVerify,
  bankValidation,
  statusCheck
};


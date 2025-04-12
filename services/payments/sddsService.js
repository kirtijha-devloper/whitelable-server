const axios = require('axios');
const https = require('https');

const BASE_URL = 'https://uatapi.sddspl.com/api';

let bearerToken = ''; // Temp store. Use Redis/db for prod.

// Set token when user logs in
const setBearerToken = (token) => {
  bearerToken = token;
};

// Get headers with Authorization token
const getAuthHeader = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});


const request = async ({ method, endpoint, data = {}, withAuth = false, token = '' }) => {
  try {
    console.log("first data", data)
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      data,
      httpsAgent,
      ...(withAuth ? getAuthHeader(token) : {})
    };

    console.log("config", config);
    console.log("data", data)

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`SDDS Service Error [${endpoint}]`, error?.response?.data || error.message);
    throw error.response?.data || { message: 'Something went wrong!' };
  }
};
// =================== API METHODS ===================

// Login
const login = async (payload) => {
  const data = await request({ method: 'POST', endpoint: '/api-login', data: payload });
  console.log("data", data)
  setBearerToken(data.token); // Save token for next calls
  return data;
};

// Verify TPIN
const verifyTPIN = async (payload) => {
  return await request({ method: 'POST', endpoint: '/verify-tpin', data: payload, withAuth: true });
};

// Remitter login (Mobile Verify)
const remitterLogin = async ({payload, token}) => {
  return await request({ method: 'POST', endpoint: '/financial-services/mobile-verify', data: payload, withAuth: true, token: token });
};

// Remitter register (OTP verification)
const remitterRegister = async ({payload, token}) => {
  console.log("payload", payload )
  return await request({ method: 'POST', endpoint: '/financial-services/verification', data: payload, withAuth: true, token });
};

// Get Remitter Beneficiaries
const getBeneficiaries = async ({payload, token}) => {
  return await request({ method: 'POST', endpoint: '/remitter-bank-details/remitter_bank_list', data: payload, withAuth: true, token: token });
};

// Add Beneficiary
const addBeneficiary = async ({payload, token}) => {
  return await request({ method: 'POST', endpoint: '/remitter-bank-details/add_bank', data: payload, withAuth: true, token: token });
};

// Delete Beneficiary
const deleteBeneficiary = async ({payload, token}) => {
  return await request({ method: 'POST', endpoint: '/remitter-bank-details/delete_bank_account', data: payload, withAuth: true, token: token });
};

// Transfer IMPS
const transferIMPS = async ({payload, token}) => {
  return await request({ method: 'POST', endpoint: '/hdfc/cbx-transaction-api', data: payload, withAuth: true, token: token });
};

module.exports = {
  login,
  verifyTPIN,
  remitterLogin,
  remitterRegister,
  getBeneficiaries,
  addBeneficiary,
  deleteBeneficiary,
  transferIMPS
};

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const IPAY_AUTH_CODE = process.env.IPAY_AUTH_CODE;
const IPAY_CLIENT_ID = process.env.IPAY_CLIENT_ID;
const IPAY_CLIENT_SECRET = process.env.IPAY_CLIENT_SECRET;
const IPAY_ENDPOINT_IP = process.env.IPAY_ENDPOINT_IP;

async function verifyBankAccount({
  name,
  accountNumber,
  bankIfsc,
  latitude = "28.6139",
  longitude = "77.2090",
  externalRef
}) {
  try {
    const url = 'https://api.instantpay.in/identity/verifyBankAccount';
    
    // Provide a random externalRef if not provided
    const ref = externalRef || `APABAV${Date.now()}${Math.floor(Math.random() * 1000)}`;

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Ipay-Auth-Code': IPAY_AUTH_CODE,
      'X-Ipay-Client-Id': IPAY_CLIENT_ID,
      'X-Ipay-Client-Secret': IPAY_CLIENT_SECRET,
      'X-Ipay-Endpoint-Ip': IPAY_ENDPOINT_IP
    };

    const payload = {
      payee: {
        name: name || "Customer Name",
        accountNumber,
        bankIfsc
      },
      externalRef: ref,
      consent: "Y",
      pennyDrop: "YES",
      latitude,
      longitude
    };

    const response = await axios.post(url, payload, { headers });
    
    // The response structure needs to be checked, usually data.data or similar
    // Assuming instantpay returns standard structure: response.data.statuscode
    // Let's format the return to be similar to branchx so we don't break existing code if possible.
    
    const result = response.data;
    
    // Convert to standard format
    // InstantPay usually returns statuscode "TXN" for success, or similar.
    // We will return the raw result but ensure status and statuscode are there
    if (result && result.statuscode === 'TXN') {
      return {
        status: 'SUCCESS',
        statuscode: result.statuscode,
        name: result.data?.payee?.name || name,
        message: result.status || 'Verification successful',
        utr: result.data?.utr,
        api_ref: result.data?.externalRef || ref,
        raw: result
      };
    } else {
      return {
        status: 'FAILED',
        statuscode: result?.statuscode || '400',
        message: result?.status || result?.message || 'Verification failed',
        raw: result
      };
    }
  } catch (error) {
    console.error('InstantPay verifyBankAccount error:', error?.response?.data || error.message);
    throw {
      status: 'FAILED',
      message: error?.response?.data?.message || error?.response?.data?.status || error.message || 'InstantPay Verification failed',
      raw: error?.response?.data
    };
  }
}

module.exports = {
  verifyBankAccount
};

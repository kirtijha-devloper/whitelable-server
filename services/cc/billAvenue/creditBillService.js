const axios = require('axios');
const { encryptRequest, decryptResponse } = require('../../../utils/encryption');

const BBPS_BASE_URL = process.env.BILLAVENUE_API_URL || 'https://api.billavenue.com/billpay';

// Send Credit Bill Payment Request
async function processCreditBillPayment(paymentData) {
  try {
    // Encrypt request body
    console.log("encrypted row data:",paymentData )
    const encryptedRequest = encryptRequest(paymentData);

    // Prepare API payload
    const payload = {
      accessCode: process.env.BILLAVENUE_ACCESS_CODE,  // from env
      requestId: generateRequestId(),                  // helper to generate ID
      encRequest: encryptedRequest,
      ver: process.env.BILLAVENUE_API_VER || '1.0',
      instituteId: process.env.BILLAVENUE_INSTITUTE_ID // from env
    };

    // POST to Bill Payment API endpoint
    const response = await axios.post(`${BBPS_BASE_URL}/extBillPayCntrl/billPayRequest/xml`, payload);

    // Decrypt response
    const decryptedResponse = decryptResponse(response.data);

    return decryptedResponse;
  } catch (error) {
    console.error('Error in processCreditBillPayment:', error);
    throw error;
  }
}

// Helper function to generate requestId as per BBPS guidelines
function generateRequestId() {
  const randomStr = Math.random().toString(36).substr(2, 27);
  const now = new Date();
  const year = now.getFullYear().toString().slice(-1);
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `${randomStr}${year}${dayOfYear}${hours}${minutes}`;
}

module.exports = {
  processCreditBillPayment
};

const axios = require('axios');
const { encryptRequest, decryptResponse } = require('../../../utils/encryption');

const BBPS_BASE_URL = process.env.BILLAVENUE_API_URL || 'https://api.billavenue.com/billpay';
const REQUEST_ID_PREFIX = 'ABL';
let requestIdSequence = 0;

function randomAlphaNumeric(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRequestId() {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-1);
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = String(Math.floor((now - startOfYear) / (1000 * 60 * 60 * 24)) + 1).padStart(3, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const datetimeSegment = `${year}${dayOfYear}${hours}${minutes}`;

  requestIdSequence = (requestIdSequence + 1) % 10000000;
  const sequenceSegment = String(requestIdSequence).padStart(7, '0');

  const randomPartLength = 27 - REQUEST_ID_PREFIX.length - sequenceSegment.length;
  const randomSegment = randomAlphaNumeric(randomPartLength);

  return `${REQUEST_ID_PREFIX}${sequenceSegment}${randomSegment}${datetimeSegment}`;
}

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

module.exports = {
  processCreditBillPayment
};

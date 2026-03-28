const axios = require('axios');
const billAvenueConfig = require('../../../config/billavenue');

/**
 * POST to BillAvenue with `application/x-www-form-urlencoded` body.
 * @param {string} endpoint  – path segment appended to apiUrl (e.g. '/getBillerInfoCntrl/billerInfoRequest/xml')
 * @param {object} formParams – key-value pairs sent as form data
 * @returns {string} raw response body (typically encrypted base64)
 */
async function postForm(endpoint, formParams) {
  // Ensure base URL ends without slash, then add the BillAvenue controller path
  const base = billAvenueConfig.apiUrl.replace(/\/+$/, '');
  const url = `${base}/billpay/extBillPayCntrl${endpoint}`;
  const params = new URLSearchParams(formParams);

  const response = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    responseType: 'text',
    timeout: 60000,
  });

  return response.data;
}

/**
 * POST to BillAvenue with raw XML body.
 * Used for endpoints that expect raw XML instead of form data.
 * @param {string} endpoint
 * @param {string} xmlBody
 * @returns {string} raw response body
 */
async function postRaw(endpoint, xmlBody) {
  const base = billAvenueConfig.apiUrl.replace(/\/+$/, '');
  const url = `${base}/billpay/extBillPayCntrl${endpoint}`;

  const response = await axios.post(url, xmlBody, {
    headers: { 'Content-Type': 'application/xml' },
    timeout: 60000,
  });

  return response.data;
}

module.exports = { postForm, postRaw };

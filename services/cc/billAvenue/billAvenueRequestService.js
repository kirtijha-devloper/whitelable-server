const axios = require('axios');
const fs = require('fs');
const path = require('path');
const billAvenueConfig = require('../../../config/billavenue');

const BILLAVENUE_LOG_FILE = path.join(__dirname, '../../../logs/billAvenue-debug.log');

function appendBillAvenueLog(entry) {
  try {
    const dir = path.dirname(BILLAVENUE_LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(BILLAVENUE_LOG_FILE, `${entry}\n\n`, 'utf8');
  } catch (writeErr) {
    console.error('[billAvenue] failed to write debug log', writeErr);
  }
}

function buildBillAvenueLog({ url, endpoint, requestBody, responseBody, errorMessage }) {
  const lines = [
    `Timestamp: ${new Date().toISOString()}`,
    `URL: ${url}`,
    `Endpoint: ${endpoint}`,
    `Request Body:`,
    requestBody || '(none)',
    `Response Body:`,
    responseBody || '(none)',
  ];

  if (errorMessage) {
    lines.push(`Error: ${errorMessage}`);
  }

  return lines.join('\n');
}

/**
 * POST to BillAvenue with `application/x-www-form-urlencoded` body.
 * @param {string} endpoint  – path segment appended to apiUrl (e.g. '/getBillerInfoCntrl/billerInfoRequest/xml')
 * @param {object} formParams – key-value pairs sent as form data
 * @returns {string} raw response body (typically encrypted base64)
 */
async function postForm(endpoint, formParams) {
  const base = billAvenueConfig.apiUrl.replace(/\/+$/, '');
  const params = new URLSearchParams(formParams);
  const url = `${base}${endpoint}?${params.toString()}`;
  const requestBody = ''; // No body since params are in the URL

  console.error('[billAvenue] POST →', url);

  try {
    const response = await axios.post(url, null, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      responseType: 'text',
      timeout: 60000,
    });

    const responseBody = String(response.data || '').trim();
    appendBillAvenueLog(buildBillAvenueLog({ url, endpoint, requestBody, responseBody }));
    return responseBody;
  } catch (err) {
    const responseBody = err?.response?.data != null ? String(err.response.data) : err.message;
    appendBillAvenueLog(buildBillAvenueLog({ url, endpoint, requestBody, responseBody, errorMessage: err.message }));
    throw err;
  }
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
  const url = `${base}${endpoint}`;

  const response = await axios.post(url, xmlBody, {
    headers: { 'Content-Type': 'application/xml' },
    timeout: 60000,
  });

  return response.data;
}

async function postJson(endpoint, jsonBody) {
  const base = billAvenueConfig.apiUrl.replace(/\/+$/, '');
  const url = `${base}${endpoint}`;

  const requestBody = JSON.stringify(jsonBody);
  try {
    const response = await axios.post(url, jsonBody, {
      headers: { 'Content-Type': 'application/json' },
      responseType: 'json',
      timeout: 60000,
    });

    const responseBody = response.data;
    appendBillAvenueLog(buildBillAvenueLog({ url, endpoint, requestBody, responseBody: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody) }));
    return responseBody;
  } catch (err) {
    const responseBody = err?.response?.data != null ? err.response.data : err.message;
    appendBillAvenueLog(buildBillAvenueLog({
      url,
      endpoint,
      requestBody,
      responseBody: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
      errorMessage: err.message,
    }));
    throw err;
  }
}

module.exports = { postForm, postRaw, postJson };

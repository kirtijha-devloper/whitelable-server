const xml2js = require('xml2js');
const NodeCache = require('node-cache');
const billAvenueConfig = require('../../../config/billavenue');
const { encrypt, decrypt } = require('./billAvenueEncryptionService');
const { postForm } = require('./billAvenueRequestService');

const billerCache = new NodeCache({ stdTTL: 3600 }); // cache biller list 1 hour

// ─── helpers ────────────────────────────────────────────────────────────────

function buildXml(rootTag, fields) {
  const builder = new xml2js.Builder({ headless: true, rootName: rootTag, renderOpts: { pretty: false } });
  return builder.buildObject(fields);
}

async function parseXml(xmlStr) {
  return xml2js.parseStringPromise(xmlStr, { explicitArray: false, trim: true });
}

function generateRequestId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `${ts}${rand}`.substring(0, 35);
}

/**
 * POST encrypted XML to BillAvenue and return decrypted + parsed response.
 */
async function callBillAvenue(endpoint, xmlPayload) {
  const encRequest = encrypt(xmlPayload);

  const formParams = {
    accessCode: billAvenueConfig.accessCode,
    requestId:  generateRequestId(),
    ver:        billAvenueConfig.ver,
    instituteId: billAvenueConfig.instituteId,
    encRequest,
  };

  const rawResponse = await postForm(endpoint, formParams);
  const raw = String(rawResponse).trim();

  // Log to stderr so it appears in pm2 error log
  console.error('[billAvenue] raw response type:', typeof rawResponse, 'length:', raw.length);
  console.error('[billAvenue] raw response preview:', raw.substring(0, 200));

  // BillAvenue may return the encrypted payload:
  //   1. As a form-encoded field: encResponse=CIPHERTEXT
  //   2. As plain ciphertext (hex or base64)
  //   3. As XML already (error responses)
  let encryptedPayload;
  if (raw.includes('encResponse=')) {
    const match = raw.match(/encResponse=([^&\s]*)/);
    encryptedPayload = match ? match[1] : raw;
  } else {
    encryptedPayload = raw;
  }

  console.error('[billAvenue] payload to decrypt (first 100):', encryptedPayload.substring(0, 100));

  // If the response is already XML (e.g. error), parse directly
  if (encryptedPayload.startsWith('<') || encryptedPayload.startsWith('<?xml')) {
    const parsed = await parseXml(encryptedPayload);
    return parsed;
  }

  // Decrypt (tries hex first, then base64)
  const decryptedXml = decrypt(encryptedPayload);
  const parsed = await parseXml(decryptedXml);
  return parsed;
}

// ─── public API methods ─────────────────────────────────────────────────────

/**
 * Get the list of billers for BillAvenue.
 * Result is cached for 1 hour.
 */
async function getBillerInfo() {
  const cacheKey = 'billerList';
  const cached = billerCache.get(cacheKey);
  if (cached) return cached;

  const xml = buildXml('billerInfoRequest', {
    agentDeviceInfo: {
      agentId: billAvenueConfig.agentId,
      ip: billAvenueConfig.agentDeviceIp,
      mac: billAvenueConfig.agentDeviceMac,
    },
  });

  const result = await callBillAvenue('/getBillerInfoCntrl/billerInfoRequest/xml', xml);
  billerCache.set(cacheKey, result);
  return result;
}

/**
 * Fetch a bill (bill fetch / validation).
 * @param {object} params
 */
async function fetchBill({ billerId, customerParams, amount, agentId, paymentMode, quickPay, splitPay }) {
  const inputParams = {};
  if (customerParams && typeof customerParams === 'object') {
    Object.entries(customerParams).forEach(([key, value]) => {
      inputParams[key] = value;
    });
  }

  const fields = {
    agentDeviceInfo: {
      agentId: agentId || billAvenueConfig.agentId,
      ip: billAvenueConfig.agentDeviceIp,
      mac: billAvenueConfig.agentDeviceMac,
    },
    billerId,
    inputParams,
  };

  if (amount) fields.amount = amount;
  if (paymentMode) fields.paymentMode = paymentMode;
  if (quickPay) fields.quickPay = quickPay;
  if (splitPay) fields.splitPay = splitPay;

  const xml = buildXml('billFetchRequest', fields);
  return callBillAvenue('/billFetchCntrl/billFetchRequest/xml', xml);
}

/**
 * Pay a bill via BillAvenue.
 * @param {object} params
 */
async function payBill({ billerId, customerParams, amount, paymentMode, quickPay, splitPay, agentId, ccf }) {
  const inputParams = {};
  if (customerParams && typeof customerParams === 'object') {
    Object.entries(customerParams).forEach(([key, value]) => {
      inputParams[key] = value;
    });
  }

  const fields = {
    agentDeviceInfo: {
      agentId: agentId || billAvenueConfig.agentId,
      ip: billAvenueConfig.agentDeviceIp,
      mac: billAvenueConfig.agentDeviceMac,
    },
    billerId,
    inputParams,
    amount: String(amount),
    paymentMode: paymentMode || 'Cash',
  };

  if (quickPay) fields.quickPay = quickPay;
  if (splitPay) fields.splitPay = splitPay;
  if (ccf) fields.ccf = ccf;

  const xml = buildXml('billPaymentRequest', fields);
  return callBillAvenue('/billPayRequest/xml', xml);
}

/**
 * Register a complaint for a failed transaction.
 */
async function registerComplaint({ complaintType, billerId, transactionRefId, reason, description, agentId }) {
  const fields = {
    agentDeviceInfo: {
      agentId: agentId || billAvenueConfig.agentId,
      ip: billAvenueConfig.agentDeviceIp,
      mac: billAvenueConfig.agentDeviceMac,
    },
    complaintType: complaintType || 'Transaction',
    participationType: 'Agent',
    billerId,
    transactionRefId,
    complaintDisposition: reason || 'Transaction Failed',
    complaintDesc: description || 'Payment issue',
  };

  const xml = buildXml('complaintRequest', fields);
  return callBillAvenue('/complaintCntrl/complaintRequest/xml', xml);
}

/**
 * Check transaction status.
 */
async function getTransactionStatus({ transactionRefId, agentId }) {
  const fields = {
    agentDeviceInfo: {
      agentId: agentId || billAvenueConfig.agentId,
      ip: billAvenueConfig.agentDeviceIp,
      mac: billAvenueConfig.agentDeviceMac,
    },
    transactionRefId,
  };

  const xml = buildXml('transactionStatusRequest', fields);
  return callBillAvenue('/transactionStatusCntrl/transactionStatusRequest/xml', xml);
}

module.exports = {
  getBillerInfo,
  fetchBill,
  payBill,
  registerComplaint,
  getTransactionStatus,
};

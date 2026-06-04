const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');
const { Op, fn, col } = require('sequelize');
const { parse } = require('csv-parse/sync');
const billAvenueConfig = require('../../../config/billavenue');
const BillAvenueBiller = require('../../../models/BillAvenueBiller');
const { encrypt, decrypt } = require('./billAvenueEncryptionService');
const { postForm, postJson } = require('./billAvenueRequestService');

const BILLAVENUE_TEXT_LOG_FILE = path.join(__dirname, '../../../logs/billAvenue.log');

function appendBillAvenueTextLog(label, data) {
  try {
    const ts = new Date().toISOString();
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.appendFileSync(BILLAVENUE_TEXT_LOG_FILE, `[${ts}] [${label}]\n${body}\n\n`, 'utf8');
  } catch (_) {
    // never crash due to log failure
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

const REQUEST_ID_PREFIX = 'ABL';
let requestIdSequence = 0;

function buildXml(rootTag, fields) {
  const builder = new xml2js.Builder({ headless: true, rootName: rootTag, renderOpts: { pretty: true } });
  let xmlStr = builder.buildObject(fields);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlStr;
}

async function parseXml(xmlStr) {
  return xml2js.parseStringPromise(xmlStr, { explicitArray: false, trim: true });
}

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
  const delimiter = 'ZZ';

  const randomPartLength = 27 - REQUEST_ID_PREFIX.length - sequenceSegment.length - delimiter.length;
  const randomSegment = randomAlphaNumeric(randomPartLength);

  return `${REQUEST_ID_PREFIX}${sequenceSegment}${delimiter}${randomSegment}${datetimeSegment}`;
}

/**
 * POST encrypted XML to BillAvenue and return decrypted + parsed response.
 */
async function callBillAvenue(endpoint, xmlPayload) {
  // Log loaded credentials for debugging (mask apiKey partially)
  const maskedKey = billAvenueConfig.apiKey
    ? billAvenueConfig.apiKey.substring(0, 4) + '***' + billAvenueConfig.apiKey.slice(-4)
    : '(empty)';
  console.error('[billAvenue] config check → apiKey:', maskedKey,
    '| accessCode:', billAvenueConfig.accessCode || '(empty)',
    '| instituteId:', billAvenueConfig.instituteId || '(empty)',
    '| apiUrl:', billAvenueConfig.apiUrl || '(empty)');

  const encRequest = encrypt(xmlPayload);

  const formParams = {
    accessCode: billAvenueConfig.accessCode,
    requestId: generateRequestId(),
    ver: billAvenueConfig.ver,
    instituteId: billAvenueConfig.instituteId,
    encRequest,
  };

  const rawResponse = await postForm(endpoint, formParams);
  const raw = String(rawResponse).trim();

  // Log the raw response preview immediately
  appendBillAvenueTextLog('callBillAvenue', {
    endpoint,
    requestId: formParams.requestId,
    requestXml: xmlPayload,
    responsePreview: raw.substring(0, 200),
    responseLength: raw.length,
  });

  // Log for debugging
  console.error('[billAvenue] raw response length:', raw.length);
  console.error('[billAvenue] raw response preview:', raw.substring(0, 200));

  // BillAvenue gateway returns HTML on access errors (IP not whitelisted, bad credentials, etc.)
  if (raw.includes('<!DOCTYPE') || raw.includes('<html')) {
    // Extract <title> for a readable error
    const titleMatch = raw.match(/<title>(.*?)<\/title>/i);
    const errorTitle = titleMatch ? titleMatch[1] : 'Access Denied';
    appendBillAvenueTextLog('callBillAvenueError', {
      endpoint,
      requestId: formParams.requestId,
      responseHtml: raw,
      errorTitle,
    });
    throw new Error(`BillAvenue API rejected the request: ${errorTitle}. Check API credentials, IP whitelist, and institute ID.`);
  }

  // Extract encrypted payload from form-encoded or plain response
  let encryptedPayload;
  if (raw.includes('encResponse=')) {
    const match = raw.match(/encResponse=([^&\s]*)/);
    encryptedPayload = match ? match[1] : raw;
  } else {
    encryptedPayload = raw;
  }

  // If the response is XML (e.g. error response), parse directly
  if (encryptedPayload.startsWith('<') || encryptedPayload.startsWith('<?xml')) {
    appendBillAvenueTextLog('callBillAvenueXmlResponse', {
      endpoint,
      requestId: formParams.requestId,
      responseXml: encryptedPayload,
    });
    const parsed = await parseXml(encryptedPayload);
    // Inject debug payload for troubleshooting UM001
    if (parsed && typeof parsed === 'object') {
      parsed._debug = { sentXml: xmlPayload };
    }
    return parsed;
  }

  // Decrypt (tries hex first, then base64)
  const decryptedXml = decrypt(encryptedPayload);
  appendBillAvenueTextLog('callBillAvenueDecrypted', {
    endpoint,
    requestId: formParams.requestId,
    decryptedXml,
  });
  const parsed = await parseXml(decryptedXml);
  if (parsed && typeof parsed === 'object') {
    parsed._debug = { sentXml: xmlPayload };
  }
  return parsed;
}

// ─── public API methods ─────────────────────────────────────────────────────

/**
 * Get the list of billers for BillAvenue.
 */
async function getBillerInfo({ category } = {}) {
  // Check local DB first and continue to use as source-of-truth when available.
  const where = { is_active: true };
  if (category) {
    where.category = category.trim();
  }

  const dbBillers = await BillAvenueBiller.findAll({ where });
  if (dbBillers?.length) {
    return {
      billers: dbBillers.map(b => ({
        billerId: b.biller_id,
        billerName: b.biller_name,
        category: b.category,
        serviceType: b.service_type,
        circle: b.circle,
        state: b.state,
        metadata: b.metadata,
      })),
    };
  }

  const xml = buildXml('billerInfoRequest', {});
  const result = await callBillAvenue('/extMdmCntrl/mdmRequestNew/xml', xml);

  const billersFromApi =
    (result?.billers?.biller || result?.billers || result?.BillerInfo?.biller || result?.BillerInfo) || [];
  const normalized = Array.isArray(billersFromApi) ? billersFromApi : [billersFromApi];

  const billers = normalized
    .filter(biller => biller && (biller.billerId || biller.biller_id || biller.id))
    .map((biller) => {
      const billerId = biller.billerId || biller.biller_id || biller.id;
      const billerName = biller.billerName || biller.biller_name || biller.name;

      return {
        billerId,
        billerName,
        category: biller.category || biller.billerCategory || null,
        serviceType: biller.serviceType || null,
        circle: biller.circle || null,
        state: biller.state || null,
        metadata: biller,
      };
    });

  await Promise.all(billers.map(async (biller) => {
    await BillAvenueBiller.upsert({
      biller_id: biller.billerId,
      biller_name: biller.billerName,
      category: biller.category,
      service_type: biller.serviceType,
      circle: biller.circle,
      state: biller.state,
      metadata: biller.metadata,
      is_active: true,
    });
  }));

  return { billers };
}

async function getBillerInfoByIdXml({ billerId } = {}) {
  if (!billerId) {
    throw new Error('Missing billerId');
  }

  const xml = buildXml('billerInfoRequest', { billerId });
  const result = await callBillAvenue('/extMdmCntrl/mdmRequestNew/xml', xml);
  return result;
}

async function getBillerInfoByIdJson({ billerId } = {}) {
  if (!billerId) {
    throw new Error('Missing billerId');
  }

  const billerIds = Array.isArray(billerId) ? billerId : [billerId];
  const result = await postJson('/extMdmCntrl/mdmRequestNew/json', { billerId: billerIds });
  return result;
}

async function getBillerCategories() {
  const categories = await BillAvenueBiller.findAll({
    attributes: [[fn('DISTINCT', col('category')), 'category']],
    where: {
      is_active: true,
      category: { [Op.ne]: null },
    },
    order: [[col('category'), 'ASC']],
  });

  return categories
    .map(row => row.category)
    .filter(category => category && category.trim())
    .map(category => category.trim());
}


/**
 * Fetch a bill (bill fetch / validation).
 * @param {object} params
 */
async function fetchBill({ billerId, customerParams, amount, paymentMode, quickPay, splitPay }) {
  const inputs = [];
  let customerMobile = '9999999999'; // Default fallback

  if (Array.isArray(customerParams)) {
    customerParams.forEach((param) => {
      if (param.name && param.value) {
        inputs.push({ paramName: param.name, paramValue: param.value });
        if (param.name.toLowerCase().includes('mobile')) {
          customerMobile = param.value;
        }
      }
    });
  } else if (customerParams && typeof customerParams === 'object') {
    Object.entries(customerParams).forEach(([key, value]) => {
      inputs.push({ paramName: key, paramValue: value });
      if (key.toLowerCase().includes('mobile')) {
        customerMobile = value;
      }
    });
  }

  // If inputs is empty, the BBPS parser will crash. We must ensure it's not empty.
  if (inputs.length === 0) {
    throw new Error('customerParams cannot be empty');
  }

  const fields = {
    agentId: 'CC01CC01513515340681',
    agentDeviceInfo: {
      ip: '192.168.2.73',
      initChannel: 'AGT',
      mac: '01-23-45-67-89-ab'
    },
    customerInfo: {
      customerMobile: customerMobile,
      customerEmail: '',
      customerAdhaar: '',
      customerPan: ''
    },
    billerId,
    inputParams: { input: inputs }
  };

  if (amount) fields.amount = amount;
  if (paymentMode) fields.paymentMode = paymentMode;
  if (quickPay) fields.quickPay = quickPay;
  if (splitPay) fields.splitPay = splitPay;

  const xml = buildXml('billFetchRequest', fields);
  return callBillAvenue('/extBillCntrl/billFetchRequest/xml', xml);
}

/**
 * Pay a bill via BillAvenue.
 * @param {object} params
 */
async function payBill({ billerId, customerParams, amount, paymentMode, quickPay, splitPay, ccf }) {
  const inputParams = {};
  if (customerParams && typeof customerParams === 'object') {
    Object.entries(customerParams).forEach(([key, value]) => {
      inputParams[key] = value;
    });
  }

  const fields = {
    billerId,
    inputParams,
    amount: String(amount),
    paymentMode: paymentMode || 'Cash',
  };

  if (quickPay) fields.quickPay = quickPay;
  if (splitPay) fields.splitPay = splitPay;
  if (ccf) fields.ccf = ccf;

  const xml = buildXml('billPaymentRequest', fields);
  return callBillAvenue('/extBillPayCntrl/billPayRequest/xml', xml);
}

/**
 * Register a complaint for a failed transaction.
 */
async function registerComplaint({ complaintType, billerId, transactionRefId, reason, description }) {
  const fields = {
    complaintType: complaintType || 'Transaction',
    participationType: 'Agent',
    billerId,
    transactionRefId,
    complaintDisposition: reason || 'Transaction Failed',
    complaintDesc: description || 'Payment issue',
  };

  const xml = buildXml('complaintRequest', fields);
  return callBillAvenue('/extComplaints/register/xml', xml);
}

async function trackComplaint({ complaintType, billerId, transactionRefId, complaintId, reason, description }) {
  const fields = {
    complaintType: complaintType || 'Transaction',
    participationType: 'Agent',
    billerId,
    transactionRefId,
    complaintId,
    complaintDisposition: reason || 'Transaction Failed',
    complaintDesc: description || 'Payment issue',
  };

  const xml = buildXml('complaintTrackRequest', fields);
  return callBillAvenue('/extComplaints/track/xml', xml);
}

async function depositEnquiry({ billerId, customerParams, amount, paymentMode, quickPay, splitPay }) {
  const inputParams = {};
  if (customerParams && typeof customerParams === 'object') {
    Object.entries(customerParams).forEach(([key, value]) => {
      inputParams[key] = value;
    });
  }

  const fields = {
    billerId,
    inputParams,
  };

  if (amount) fields.amount = amount;
  if (paymentMode) fields.paymentMode = paymentMode;
  if (quickPay) fields.quickPay = quickPay;
  if (splitPay) fields.splitPay = splitPay;

  const xml = buildXml('depositEnquiryRequest', fields);
  return callBillAvenue('/enquireDeposit/fetchDetails/xml', xml);
}

async function validateBill({ billerId, customerParams, amount, paymentMode, quickPay, splitPay }) {
  const inputParams = {};
  if (customerParams && typeof customerParams === 'object') {
    Object.entries(customerParams).forEach(([key, value]) => {
      inputParams[key] = value;
    });
  }

  const fields = {
    billerId,
    inputParams,
  };

  if (amount) fields.amount = amount;
  if (paymentMode) fields.paymentMode = paymentMode;
  if (quickPay) fields.quickPay = quickPay;
  if (splitPay) fields.splitPay = splitPay;

  const xml = buildXml('billValidationRequest', fields);
  return callBillAvenue('/extBillValCntrl/billValidationRequest/xml', xml);
}

/**
 * Check transaction status.
 */
async function getTransactionStatus({ transactionRefId }) {
  const fields = {
    transactionRefId,
  };

  const xml = buildXml('transactionStatusRequest', fields);
  return callBillAvenue('/transactionStatus/fetchInfo/xml', xml);
}

async function importBillerListFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('File path does not exist');
  }

  const ext = path.extname(filePath).toLowerCase();
  let rows = [];

  if (ext === '.csv') {
    const csvText = fs.readFileSync(filePath, 'utf-8');
    rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } else {
    throw new Error('Unsupported file type. Use .csv only');
  }

  const result = {
    imported: 0,
    skipped: 0,
    errors: [],
  };

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const billerId = String(row.billerId || row.biller_id || row.blr_id || row.BLR_ID || '').trim();
    const billerName = String(row.billerName || row.biller_name || row.blr_name || row.BLR_NAME || '').trim();
    const aliasName = String(row.blr_alias_name || row.BLR_ALIAS_NAME || '').trim();
    const categoryName = String(row.blr_category_name || row.BLR_CATEGORY_NAME || '').trim();
    const coverage = String(row.blr_coverage || row.BLR_COVERAGE || '').trim();

    if (!billerId || !billerName) {
      result.skipped += 1;
      result.errors.push({ row: index + 2, error: 'Missing billerId or billerName', data: row });
      continue;
    }

    try {
      await BillAvenueBiller.upsert({
        biller_id: billerId,
        biller_name: billerName,
        category: categoryName || row.category || row.Category || null,
        service_type: coverage || row.serviceType || row.service_type || row.ServiceType || null,
        circle: aliasName || row.circle || row.Circle || null,
        state: row.state || row.State || null,
        is_active: String(row.isActive || row.is_active || row.Active || 'true').toLowerCase() !== 'false',
        metadata: row,
      });
      result.imported += 1;
    } catch (err) {
      result.skipped += 1;
      result.errors.push({ row: index + 2, error: err.message || 'Upsert failed', data: row });
    }
  }

  return result;
}

module.exports = {
  getBillerInfo,
  getBillerInfoByIdXml,
  getBillerInfoByIdJson,
  getBillerCategories,
  fetchBill,
  payBill,
  registerComplaint,
  trackComplaint,
  validateBill,
  depositEnquiry,
  getTransactionStatus,
  importBillerListFromFile,
};

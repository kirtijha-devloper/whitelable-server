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
  const builder = new xml2js.Builder({ headless: true, rootName: rootTag, renderOpts: { pretty: false } });
  return builder.buildObject(fields);
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
async function callBillAvenue(endpoint, xmlPayload, forcedRequestId) {
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
    requestId: forcedRequestId || generateRequestId(),
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

  const base = require('../../../config/billavenue').apiUrl.replace(/\/+$/, '');
  let fullUrl = '';
  if (endpoint.includes('mdmRequestNew')) {
    const { encRequest, ...urlParamsObj } = formParams;
    fullUrl = `${base}${endpoint}?${new URLSearchParams(urlParamsObj).toString()}`;
  } else {
    fullUrl = `${base}${endpoint}?${new URLSearchParams(formParams).toString()}`;
  }

  // If the response is XML (e.g. error response), parse directly
  if (encryptedPayload.startsWith('<') || encryptedPayload.startsWith('<?xml')) {
    appendBillAvenueTextLog('callBillAvenueXmlResponse', {
      endpoint,
      requestId: formParams.requestId,
      responseXml: encryptedPayload,
    });
    const parsed = await parseXml(encryptedPayload);
    if (parsed && typeof parsed === 'object') {
      Object.defineProperty(parsed, '_requestId', { value: formParams.requestId, enumerable: true });
      Object.defineProperty(parsed, '_requestXml', { value: xmlPayload, enumerable: true });
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
    Object.defineProperty(parsed, '_requestId', { value: formParams.requestId, enumerable: true });
    Object.defineProperty(parsed, '_requestXml', { value: xmlPayload, enumerable: true });
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

  // 1. Check local DB first to avoid MDM fetch daily limit errors
  const dbBiller = await BillAvenueBiller.findOne({ where: { biller_id: billerId } });
  if (dbBiller && dbBiller.metadata && typeof dbBiller.metadata === 'object' && Object.keys(dbBiller.metadata).length > 0) {
    console.log(`[billAvenue] Serving biller info from DB cache for billerId: ${billerId}`);
    return dbBiller.metadata;
  }

  // 2. Call external BillAvenue API if not cached
  const xml = buildXml('billerInfoRequest', { billerId });
  const result = await callBillAvenue('/extMdmCntrl/mdmRequestNew/xml', xml);

  // 3. Cache response in DB for future requests
  if (result) {
    try {
      if (dbBiller) {
        await dbBiller.update({ metadata: result });
      } else {
        await BillAvenueBiller.create({
          biller_id: billerId,
          biller_name: billerId,
          metadata: result,
          is_active: true,
        });
      }
    } catch (dbErr) {
      console.error(`[billAvenue] Failed to cache biller info metadata for ${billerId}:`, dbErr.message);
    }
  }

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
async function fetchBill({ billerId, customerParams, amount, paymentMode, quickPay, splitPay, initChannel }) {

  const inputs = [];
  let customerMobile = '9999999999'; // Default fallback

  if (Array.isArray(customerParams)) {
    customerParams.forEach((param) => {
      if (param.name && param.value) {
        inputs.push({ paramName: param.name.trim(), paramValue: param.value.trim() });
        if (param.name.toLowerCase().includes('mobile')) {
          customerMobile = param.value.trim();
        }
      }
    });
  } else if (customerParams && typeof customerParams === 'object') {
    Object.entries(customerParams).forEach(([key, value]) => {
      inputs.push({ paramName: key.trim(), paramValue: String(value).trim() });
      if (key.toLowerCase().includes('mobile')) {
        customerMobile = String(value).trim();
      }
    });
  }

  // If inputs is empty, the BBPS parser will crash. We must ensure it's not empty.
  if (inputs.length === 0) {
    throw new Error('customerParams cannot be empty');
  }

  const fields = {
    agentId: require('../../../config/billavenue').agentId,
    agentDeviceInfo: {
      ip: '147.93.110.29',
      initChannel: initChannel || 'AGT',
      mac: require('../../../config/billavenue').mac
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
function buildStandardFields(billerId, customerParams, amount, paymentMode, initChannel) {
  const inputs = [];
  let customerMobile = '9999999999';

  if (Array.isArray(customerParams)) {
    customerParams.forEach((param) => {
      if (param.name && param.value) {
        inputs.push({ paramName: String(param.name).trim(), paramValue: String(param.value).trim() });
        if (String(param.name).toLowerCase().includes('mobile')) {
          customerMobile = String(param.value).trim();
        }
      }
    });
  } else if (customerParams && typeof customerParams === 'object') {
    Object.entries(customerParams).forEach(([key, value]) => {
      inputs.push({ paramName: key.trim(), paramValue: String(value).trim() });
      if (key.toLowerCase().includes('mobile')) {
        customerMobile = String(value).trim();
      }
    });
  }

  if (inputs.length === 0) {
    throw new Error('customerParams cannot be empty');
  }

  const fields = {
    agentId: require('../../../config/billavenue').agentId,
    agentDeviceInfo: {
      ip: '147.93.110.29',
      initChannel: initChannel || 'AGT',
      mac: require('../../../config/billavenue').mac
    },
    customerInfo: {
      customerMobile: customerMobile,
      customerEmail: '',
      customerAdhaar: '',
      customerPan: ''
    },
    billerId,
    inputParams: { input: inputs },
  };

  if (amount) fields.amount = String(amount);
  if (paymentMode) fields.paymentMode = paymentMode;

  return fields;
}

async function payBill({ billerId, customerParams, amount, paymentMode, quickPay, splitPay, ccf, billerResponseInfo, additionalInfo, requestId, initChannel }) {
  const baseFields = buildStandardFields(billerId, customerParams, null, null, initChannel);
  delete baseFields.amount;
  delete baseFields.paymentMode;

  // Strict XSD sequence reconstruction
  const orderedFields = {};
  
  // 1. Core routing and agent info
  orderedFields.agentId = baseFields.agentId;
  orderedFields.agentDeviceInfo = baseFields.agentDeviceInfo;
  orderedFields.customerInfo = baseFields.customerInfo;
  
  // 2. Biller specifics
  orderedFields.billerId = baseFields.billerId;
  orderedFields.inputParams = baseFields.inputParams;

  // 3. Biller Response (MUST come before amountInfo per BBPS schema)
  if (billerResponseInfo && Object.keys(billerResponseInfo).length > 0) {
    // To avoid E211: billerResponse value mismatch, we MUST pass the exact same object
    // without renaming properties (like billAmount -> amountDue).
    // To avoid UM001: Invalid XML request, we MUST arrange the properties in the exact
    // order defined by the BBPS XSD.
    const xsdOrder = [
      'customerName', 'amountDue', 'billAmount', 'dueDate', 
      'billDate', 'billNumber', 'billPeriod', 'billerAdditionalInfo'
    ];

    const orderedBr = {};
    xsdOrder.forEach(key => {
      if (billerResponseInfo[key] !== undefined) {
        orderedBr[key] = billerResponseInfo[key];
      }
    });

    // Add any unexpected keys just in case, appended at the end
    Object.keys(billerResponseInfo).forEach(key => {
      if (!xsdOrder.includes(key) && key !== 'additionalInfo') {
        orderedBr[key] = billerResponseInfo[key];
      }
    });

    orderedFields.billerResponse = orderedBr;
  }
  // BBPS requires additional info from fetch to be sent as additionalInfo in pay
  const addInfo = additionalInfo || (billerResponseInfo && (billerResponseInfo.additionalInfo || billerResponseInfo.billerAdditionalInfo));
  if (addInfo) {
    orderedFields.additionalInfo = addInfo;
  }
  // 4. Amount Info
  orderedFields.amountInfo = {
    amount: String(amount * 100), 
    currency: '356',
    custConvFee: ccf || '0',
    amountTags: ''
  };

  // 5. Payment Method
  orderedFields.paymentMethod = {
    paymentMode: paymentMode || 'Cash',
    quickPay: quickPay || 'N',
    splitPay: splitPay || 'N'
  };

  // 6. Payment Info
  orderedFields.paymentInfo = {
    info: {
      infoName: 'Remarks',
      infoValue: 'Received'
    }
  };

  const xml = buildXml('billPaymentRequest', orderedFields);
  return callBillAvenue('/extBillPayCntrl/billPayRequest/xml', xml, requestId);
}

async function registerComplaint({ complaintType, billerId, transactionRefId, reason, description }) {
  const fields = {
    agentId: require('../../../config/billavenue').agentId,
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
    agentId: require('../../../config/billavenue').agentId,
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
  const fields = buildStandardFields(billerId, customerParams, amount, paymentMode);
  if (quickPay) fields.quickPay = quickPay;
  if (splitPay) fields.splitPay = splitPay;

  const xml = buildXml('depositEnquiryRequest', fields);
  return callBillAvenue('/enquireDeposit/fetchDetails/xml', xml);
}

async function validateBill({ billerId, customerParams, amount, paymentMode, quickPay, splitPay }) {
  const fields = buildStandardFields(billerId, customerParams, amount, paymentMode);
  if (quickPay) fields.quickPay = quickPay;
  if (splitPay) fields.splitPay = splitPay;

  const xml = buildXml('billValidationRequest', fields);
  return callBillAvenue('/extBillValCntrl/billValidationRequest/xml', xml);
}

/**
 * Check transaction status using official BillAvenue specification.
 * Supports REQUEST_ID (35 chars) or TRANS_REF_ID trackType.
 */
async function getTransactionStatus({ transactionRefId, requestId }) {
  const fields = {};

  const cleanReqId = String(requestId || '').trim();
  const cleanTxnRefId = String(transactionRefId || '').trim();

  if (cleanReqId.length > 0) {
    fields.trackType = 'REQUEST_ID';
    fields.trackValue = cleanReqId;
  } else if (cleanTxnRefId.length > 0) {
    fields.trackType = 'TRANS_REF_ID';
    fields.trackValue = cleanTxnRefId;
  } else {
    throw new Error('Either requestId (35-digit) or transactionRefId is required for status check');
  }

  const xml = buildXml('transactionStatusReq', fields);
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

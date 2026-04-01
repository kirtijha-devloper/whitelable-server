const xml2js = require('xml2js');
const NodeCache = require('node-cache');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
let xlsx;
try {
  xlsx = require('xlsx');
} catch (err) {
  console.warn('[billAvenue] xlsx dependency is missing; XLS/XLSX import support is disabled. Install with `npm install xlsx`.');
}
const billAvenueConfig = require('../../../config/billavenue');
const BillAvenueBiller = require('../../../models/BillAvenueBiller');
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
    requestId:  generateRequestId(),
    ver:        billAvenueConfig.ver,
    instituteId: billAvenueConfig.instituteId,
    encRequest,
  };

  const rawResponse = await postForm(endpoint, formParams);
  const raw = String(rawResponse).trim();

  // Log for debugging
  console.error('[billAvenue] raw response length:', raw.length);
  console.error('[billAvenue] raw response preview:', raw.substring(0, 200));

  // BillAvenue gateway returns HTML on access errors (IP not whitelisted, bad credentials, etc.)
  if (raw.includes('<!DOCTYPE') || raw.includes('<html')) {
    // Extract <title> for a readable error
    const titleMatch = raw.match(/<title>(.*?)<\/title>/i);
    const errorTitle = titleMatch ? titleMatch[1] : 'Access Denied';
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

  // Check local DB first and continue to use as source-of-truth when available.
  const dbBillers = await BillAvenueBiller.findAll({ where: { is_active: true } });
  if (dbBillers?.length) {
    const data = { billers: dbBillers.map(b => ({
      billerId: b.biller_id,
      billerName: b.biller_name,
      category: b.category,
      serviceType: b.service_type,
      circle: b.circle,
      state: b.state,
      metadata: b.metadata,
    })) };
    billerCache.set(cacheKey, data);
    return data;
  }

  // Staging environment uses hardcoded test billers (BillAvenue staging API
  // does not serve a real biller list)
  const isStaging = billAvenueConfig.apiUrl && billAvenueConfig.apiUrl.includes('stgapi');
  if (isStaging) {
    const testBillers = {
      billers: [
        { billerId: 'OTME00005XXZ43', billerName: 'Test Biller 1' },
        { billerId: 'biller2', billerName: 'Biller 2' },
        { billerId: 'biller3', billerName: 'Biller 3' },
      ],
    };
    billerCache.set(cacheKey, testBillers);
    return testBillers;
  }

  const xml = buildXml('billerInfoRequest', {});
  const result = await callBillAvenue('/getBillerInfoCntrl/billerInfoRequest/xml', xml);

  const billersFromApi =
    (result?.billers?.biller || result?.billers || result?.BillerInfo?.biller || result?.BillerInfo) || [];
  const normalized = Array.isArray(billersFromApi) ? billersFromApi : [billersFromApi];

  await Promise.all(normalized.map(async (biller) => {
    if (!biller || !biller.billerId) return;

    // BillAvenue API fields could be lowercase or uppercase variants.
    const billerId = biller.billerId || biller.biller_id || biller.id;
    const billerName = biller.billerName || biller.biller_name || biller.name;

    if (!billerId || !billerName) return;

    await BillAvenueBiller.upsert({
      biller_id: billerId,
      biller_name: billerName,
      category: biller.category || biller.billerCategory || null,
      service_type: biller.serviceType || null,
      circle: biller.circle || null,
      state: biller.state || null,
      metadata: biller,
      is_active: true,
    });
  }));

  billerCache.set(cacheKey, result);
  return result;
}


/**
 * Fetch a bill (bill fetch / validation).
 * @param {object} params
 */
async function fetchBill({ billerId, customerParams, amount, paymentMode, quickPay, splitPay }) {
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

  const xml = buildXml('billFetchRequest', fields);
  return callBillAvenue('/billFetchCntrl/billFetchRequest/xml', xml);
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
  return callBillAvenue('/billPayRequest/xml', xml);
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
  return callBillAvenue('/complaintCntrl/complaintRequest/xml', xml);
}

/**
 * Check transaction status.
 */
async function getTransactionStatus({ transactionRefId }) {
  const fields = {
    transactionRefId,
  };

  const xml = buildXml('transactionStatusRequest', fields);
  return callBillAvenue('/transactionStatusCntrl/transactionStatusRequest/xml', xml);
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
  } else if (ext === '.xls' || ext === '.xlsx') {
    if (!xlsx) {
      throw new Error('XLS/XLSX import is unavailable because dependency `xlsx` is not installed. Run `npm install xlsx`.');
    }
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('No sheet found in Excel file');
    }
    rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });
  } else {
    throw new Error('Unsupported file type. Use .csv, .xls, or .xlsx');
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
  fetchBill,
  payBill,
  registerComplaint,
  getTransactionStatus,
  importBillerListFromFile,
};

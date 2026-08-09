const axios = require('axios');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '../../../logs/bbpsCCBill.log');
function svcLog(msg) {
  const ts = new Date().toISOString();
  fs.appendFile(logFile, `[${ts}] [service] ${msg}\n`, () => {});
}

/**
 * BBPS CC Bill Payment Service
 * Provider: InstantPay (api.instantpay.in)
 *
 * Environment variables required (.env):
 *   IPAY_AUTH_CODE      – InstantPay auth code
 *   IPAY_CLIENT_ID      – InstantPay client ID
 *   IPAY_CLIENT_SECRET  – InstantPay client secret
 *   IPAY_ENDPOINT_IP    – Your server's IP registered with InstantPay
 *   IPAY_OUTLET_ID      – Default outlet ID (can be overridden per-user)
 *
 * CC Bill category key on InstantPay: C15
 */

const BASE_URL = 'https://api.instantpay.in/marketplace/utilityPayments';
const CC_CATEGORY_KEY = 'C15';

/** Build InstantPay request headers. outletId can be per-user or fall back to env.
 *  PHP uses intval(session('outlet')), so we always send a number, never a string.
 */
function buildHeaders(outletId) {
  const resolvedOutlet = parseInt(outletId || process.env.IPAY_OUTLET_ID, 10);
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Ipay-Auth-Code': process.env.IPAY_AUTH_CODE,
    'X-Ipay-Client-Id': process.env.IPAY_CLIENT_ID,
    'X-Ipay-Client-Secret': process.env.IPAY_CLIENT_SECRET,
    'X-Ipay-Endpoint-Ip': process.env.IPAY_ENDPOINT_IP,
    'X-Ipay-Outlet-Id': isNaN(resolvedOutlet) ? undefined : resolvedOutlet,
  };
}

/** Generate unique external reference: APBBPS{year}{epoch_ms} */
function generateExternalRef() {
  return `APBBPS${new Date().getFullYear()}${Date.now()}`;
}

/**
 * Fetch all BBPS utility categories from InstantPay.
 * PHP ref: getCategory()
 */
async function getCategories(outletId) {
  const response = await axios.get(`${BASE_URL}/category`, {
    headers: buildHeaders(outletId),
  });
  return response.data;
}

/**
 * Fetch billers list for Credit Card (category key C15).
 * PHP ref: getBillersForCreditCards()
 */
async function getCCBillers(outletId) {
  const response = await axios.post(`${BASE_URL}/billers`, {
    pagination: { pageNumber: 1, recordsPerPage: 100 },
    filters: { categoryKey: CC_CATEGORY_KEY, updatedAfterDate: '' },
  }, {
    headers: buildHeaders(outletId),
  });

  svcLog(`getCCBillers RESPONSE: ${JSON.stringify(response.data)}`);

  const billers = response.data?.data?.records ?? [];
  const result = billers.map(b => ({ billerId: b.billerId, billerName: b.billerName }));
  svcLog(`getCCBillers PARSED biller count=${result.length}`);
  return result;
}

/**
 * Fetch details for a specific biller.
 * PHP ref: getBillerDetails()
 */
async function getBillerDetails(billerId, outletId) {
  const response = await axios.post(`${BASE_URL}/billerDetails`, { billerId }, {
    headers: buildHeaders(outletId),
  });
  return response.data;
}

/**
 * Pre-payment enquiry (bill fetch / validate).
 * Used when biller's supportValidation === 'MANDATORY' or fetchRequirement === 'MANDATORY'.
 * PHP ref: getAllData() → prePaymentEnquiry branch
 *
 * @param {object} opts
 * @param {string}  opts.billerId
 * @param {string}  opts.initChannel
 * @param {string}  opts.param1           – card / account number
 * @param {string}  [opts.param2]
 * @param {number}  opts.transactionAmount
 * @param {string}  opts.ipAddress
 * @param {string}  opts.outletId
 * @param {string}  [opts.customerMobile] – used in remarks
 */
async function prePaymentEnquiry(opts) {
  const externalRef = generateExternalRef();
  const remarkParam = (String(opts.param1).length === 10 ? opts.param1 : opts.param2) || opts.customerMobile || '9999999999';

  const payload = {
    billerId:          opts.billerId,
    initChannel:       opts.initChannel,
    externalRef,
    inputParameters:   { param1: opts.param1, param2: opts.param2 ?? '' },
    deviceInfo:        { mac: '00:00:00:00:00:00', ip: opts.ipAddress || '0.0.0.0' },
    remarks:           { param1: remarkParam },
    transactionAmount: opts.transactionAmount,
  };

  svcLog(`prePaymentEnquiry PAYLOAD: ${JSON.stringify(payload)}`);

  const response = await axios.post(`${BASE_URL}/prePaymentEnquiry`, payload, {
    headers: buildHeaders(opts.outletId),
    timeout: 30000,
  });

  svcLog(`prePaymentEnquiry RESPONSE: ${JSON.stringify(response.data)}`);

  return { externalRef, data: response.data };
}

/**
 * Execute CC bill payment via InstantPay.
 * PHP ref: paybill()
 *
 * @param {object} opts
 * @param {string}  opts.billerId
 * @param {string}  opts.initChannel
 * @param {string}  opts.param1            – card / account number
 * @param {string}  [opts.param2]
 * @param {number}  opts.transactionAmount  – in rupees
 * @param {string}  opts.paymentMode        – 'Cash' | 'UPI' | etc.
 * @param {object}  [opts.paymentInfo]      – dynamic fields per selectedPaymentMode
 * @param {string}  opts.customerMobile
 * @param {string}  opts.geoCode
 * @param {string}  [opts.enquiryReferenceId]
 * @param {string}  [opts.customerPan]
 * @param {string}  opts.outletId
 * @param {string}  opts.ipAddress
 */
async function payCCBill(opts) {
  // Allow caller to supply an externalRef (e.g. one already persisted to the DB
  // before the API call) so the reference is always available even on failure.
  const externalRef = opts.externalRef || generateExternalRef();

  const payload = {
    billerId:           opts.billerId,
    externalRef,
    telecomCircle:      '',
    enquiryReferenceId: opts.enquiryReferenceId ?? '',
    inputParameters:    { param1: opts.param1, param2: opts.param2 ?? '' },
    initChannel:        opts.initChannel,
    deviceInfo: {
      terminalId: opts.customerMobile,
      mobile:     opts.customerMobile,
      postalCode: '110044',
      ...(opts.geoCode ? { geoCode: opts.geoCode } : {}),
    },
    paymentMode: opts.paymentMode || 'Cash',
    paymentInfo: opts.paymentInfo || { Remarks: 'CC Bill Payment' },
    remarks:     { param1: opts.customerMobile },
    transactionAmount: opts.transactionAmount,
  };

  if (opts.customerPan) {
    payload.customerPan = opts.customerPan;
  }

  svcLog(`payCCBill PAYLOAD: ${JSON.stringify(payload)}`);

  const response = await axios.post(`${BASE_URL}/payment`, payload, {
    headers: buildHeaders(opts.outletId),
    timeout: 60000,
  });

  svcLog(`payCCBill RESPONSE: ${JSON.stringify(response.data)}`);

  return { externalRef, data: response.data };
}

module.exports = {
  getCategories,
  getCCBillers,
  getBillerDetails,
  prePaymentEnquiry,
  payCCBill,
  generateExternalRef,
};

const axios = require('axios');

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

/** Build InstantPay request headers. outletId can be per-user or fall back to env. */
function buildHeaders(outletId) {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Ipay-Auth-Code': process.env.IPAY_AUTH_CODE,
    'X-Ipay-Client-Id': process.env.IPAY_CLIENT_ID,
    'X-Ipay-Client-Secret': process.env.IPAY_CLIENT_SECRET,
    'X-Ipay-Endpoint-Ip': process.env.IPAY_ENDPOINT_IP,
    'X-Ipay-Outlet-Id': outletId || process.env.IPAY_OUTLET_ID,
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

  const billers = response.data?.data?.records ?? [];
  return billers.map(b => ({ billerId: b.billerId, billerName: b.billerName }));
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

  const response = await axios.post(`${BASE_URL}/prePaymentEnquiry`, {
    billerId:          opts.billerId,
    initChannel:       opts.initChannel,
    externalRef,
    inputParameters:   { param1: opts.param1, param2: opts.param2 ?? '' },
    deviceInfo:        { mac: '00:00:00:00:00:00', ip: opts.ipAddress || '0.0.0.0' },
    remarks:           { param1: remarkParam },
    transactionAmount: opts.transactionAmount,
  }, {
    headers: buildHeaders(opts.outletId),
    timeout: 30000,
  });

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
  const externalRef = generateExternalRef();

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
      geoCode:    opts.geoCode || '0.0,0.0',
    },
    paymentMode: opts.paymentMode || 'Cash',
    paymentInfo: opts.paymentInfo || { Remarks: 'CC Bill Payment' },
    remarks:     { param1: opts.customerMobile },
    transactionAmount: opts.transactionAmount,
  };

  if (opts.customerPan) {
    payload.customerPan = opts.customerPan;
  }

  const response = await axios.post(`${BASE_URL}/payment`, payload, {
    headers: buildHeaders(opts.outletId),
    timeout: 60000,
  });

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

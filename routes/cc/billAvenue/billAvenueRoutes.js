const express = require('express');
const router = express.Router();
const upload = require('../../../middleware/uploadMiddleware');
const {
  getBillers,
  getBillerCategories,
  getBillerInfoById,
  getBillerInfoByIdJson,
  seedBillerMetadata,
  uploadBillersFromFile,
  fetchBill,
  validateBill,
  payBill,
  depositEnquiry,
  trackComplaint,
  getPayments,
  getPayment,
  registerComplaint,
  getTransactionStatus,
} = require('../../../controllers/cc/billAvenue/billAvenueBillController');
const {
  getSupportedBanks: getCcBill3SupportedBanks,
  payCcBill3,
  getCcBill3Status,
} = require('../../../controllers/cc/billAvenue/ccBill3Controller');

const validateToken = require('../../../middleware/validateTokenHandler');
const validateWhitelabelDomain = require('../../../middleware/validateWhitelabelDomain');

// All routes protected by JWT
router.use(validateToken);
router.use(validateWhitelabelDomain);

// GET  /api/bill-avenue/billers              – Biller list, optional ?category=<value>
router.get('/billers', getBillers);

// GET  /api/bill-avenue/categories           – Distinct BillAvenue biller categories
router.get('/categories', getBillerCategories);

// POST /api/bill-avenue/billers/upload       – Upload Excel/CSV biller list
router.post('/billers/upload', upload.single('file'), uploadBillersFromFile);

// POST /api/bill-avenue/biller-info       – Fetch biller info using BillAvenue XML payload
router.post('/biller-info', getBillerInfoById);

// POST /api/bill-avenue/biller-info-json  – Fetch biller info using BillAvenue JSON payload
router.post('/biller-info-json', getBillerInfoByIdJson);

// POST /api/bill-avenue/seed-biller-metadata – Seed / update cached biller metadata in DB
router.post('/seed-biller-metadata', seedBillerMetadata);

// POST /api/bill-avenue/fetch-bill           – Fetch/validate a bill
router.post('/fetch-bill', fetchBill);

// GET  /api/bill-avenue/cc-bill-3/banks      – Supported CC Bill 3 Vimo bank mapping
router.get('/cc-bill-3/banks', getCcBill3SupportedBanks);

// POST /api/bill-avenue/cc-bill-3/pay        – Execute CC Bill 3 via Vimo after BillAvenue fetch
router.post('/cc-bill-3/pay', payCcBill3);

// GET  /api/bill-avenue/cc-bill-3/payments/:id – Poll CC Bill 3 payment status
router.get('/cc-bill-3/payments/:id', getCcBill3Status);

// POST /api/bill-avenue/pay                  – Execute bill payment
router.post('/pay', payBill);

// GET  /api/bill-avenue/payments             – List payment records
router.get('/payments', getPayments);

// GET  /api/bill-avenue/payments/:id         – Get single payment record
router.get('/payments/:id', getPayment);

// POST /api/bill-avenue/complaint            – Register complaint
router.post('/complaint', registerComplaint);

// POST /api/bill-avenue/complaint-track      – Track complaint status
router.post('/complaint-track', trackComplaint);

// POST /api/bill-avenue/validate-bill        – Validate a bill
router.post('/validate-bill', validateBill);

// POST /api/bill-avenue/deposit-enquiry      – Enquire about deposit details
router.post('/deposit-enquiry', depositEnquiry);

// POST /api/bill-avenue/transaction-status   – Check transaction status
router.post('/transaction-status', getTransactionStatus);

module.exports = router;

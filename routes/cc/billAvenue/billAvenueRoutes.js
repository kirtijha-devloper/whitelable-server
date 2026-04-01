const express = require('express');
const router = express.Router();
const upload = require('../../../middleware/uploadMiddleware');
const {
  getBillers,
  uploadBillersFromFile,
  fetchBill,
  payBill,
  getPayments,
  getPayment,
  registerComplaint,
  getTransactionStatus,
} = require('../../../controllers/cc/billAvenue/billAvenueBillController');

const validateToken = require('../../../middleware/validateTokenHandler');

// All routes protected by JWT
router.use(validateToken);

// GET  /api/bill-avenue/billers              – Cached biller list
router.get('/billers', getBillers);

// POST /api/bill-avenue/billers/upload       – Upload Excel/CSV biller list
router.post('/billers/upload', upload.single('file'), uploadBillersFromFile);

// POST /api/bill-avenue/fetch-bill           – Fetch/validate a bill
router.post('/fetch-bill', fetchBill);

// POST /api/bill-avenue/pay                  – Execute bill payment
router.post('/pay', payBill);

// GET  /api/bill-avenue/payments             – List payment records
router.get('/payments', getPayments);

// GET  /api/bill-avenue/payments/:id         – Get single payment record
router.get('/payments/:id', getPayment);

// POST /api/bill-avenue/complaint            – Register complaint
router.post('/complaint', registerComplaint);

// POST /api/bill-avenue/transaction-status   – Check transaction status
router.post('/transaction-status', getTransactionStatus);

module.exports = router;

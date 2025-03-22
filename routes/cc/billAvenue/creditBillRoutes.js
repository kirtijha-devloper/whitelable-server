const express = require('express');
const router = express.Router();
const { creditBillPayment } = require('../../../controllers/cc/billAvenue/creditBillController');

// Endpoint: POST /api/credit-bill/payment
router.post('/payment', creditBillPayment);

module.exports = router;

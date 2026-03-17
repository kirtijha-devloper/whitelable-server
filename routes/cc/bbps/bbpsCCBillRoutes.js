const express = require('express');
const router = express.Router();
const {
  getCategories,
  getCCBillers,
  getBillerDetails,
  prePaymentEnquiry,
  payCCBill,
  getCcBillPayments,
  getCcBillPayment,
  getBbpsCcChargeRules,
  createBbpsCcChargeRule,
  updateBbpsCcChargeRule,
  deleteBbpsCcChargeRule,
} = require('../../../controllers/cc/bbps/bbpsCCBillController');

const validateToken = require('../../../middleware/validateTokenHandler');

// All routes protected by JWT
router.use(validateToken);

// GET  /api/bbps-cc/categories          – All BBPS utility categories
router.get('/categories', getCategories);

// GET  /api/bbps-cc/billers             – CC billers list (InstantPay category C15)
router.get('/billers', getCCBillers);

// POST /api/bbps-cc/biller-details      – Details + input schema for a specific biller
router.post('/biller-details', getBillerDetails);

// POST /api/bbps-cc/pre-payment-enquiry – Fetch/validate bill (mandatory for some billers)
router.post('/pre-payment-enquiry', prePaymentEnquiry);

// POST /api/bbps-cc/pay                 – Execute CC bill payment
router.post('/pay', payCCBill);

// GET /api/bbps-cc/payments            – List CC bill payment records (admin sees all)
router.get('/payments', getCcBillPayments);

// GET /api/bbps-cc/payments/:id        – Get a specific CC bill payment record
router.get('/payments/:id', getCcBillPayment);

// CC charge rules (admin only)
router.get('/charge-rules', getBbpsCcChargeRules);
router.post('/charge-rules', createBbpsCcChargeRule);
router.put('/charge-rules/:id', updateBbpsCcChargeRule);
router.delete('/charge-rules/:id', deleteBbpsCcChargeRule);

module.exports = router;

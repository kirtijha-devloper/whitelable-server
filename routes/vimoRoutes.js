const express = require('express');
const vimoController = require('../controllers/vimoController');
const validateToken = require('../middleware/validateTokenHandler');
const { ensureEmployeePermission } = require('../middleware/employeePermissionHandler');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const {
  getSupportedBanks: getCcBill3SupportedBanks,
  payCcBill3,
  getCcBill3Status,
} = require('../controllers/cc/billAvenue/ccBill3Controller');
const router = express.Router();

// Webhook callback should be open to Vimo provider; no user JWT required.
router.post('/callback', vimoController.handleCallback);

// limit check is public for PARTNER-PG
router.post('/payout/limit-check', vimoController.checkBeneficiaryLimit);

router.use(validateToken);

router.post('/auth/token', vimoController.fetchTokenStatus);
router.get('/auth/token', vimoController.fetchTokenStatus); // support GET for frontend convenience
router.get('/banks', vimoController.fetchBankList);
router.get('/purposes', vimoController.fetchPurposeList);
router.get('/states', vimoController.fetchStateList);
router.get('/balance', vimoController.getWalletBalance);

// Vimo payout and beneficiary management
router.get('/payout/reference', vimoController.getPayoutReference);
router.post('/payout', vimoController.createPayout);
router.post('/payout/status', vimoController.checkPayoutStatus);
router.get('/payout/status', vimoController.checkPayoutStatus);
router.get('/cc-bill-3/banks', getCcBill3SupportedBanks);
router.post('/cc-bill-3/pay', payCcBill3);
router.get('/cc-bill-3/payments/:id', getCcBill3Status);
router.get('/payout/audit-logs/by-reference', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.PAYOUT_READ), vimoController.getPayoutAuditLogsByReference);
router.post('/payout/admin/fail', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE), vimoController.failProcessingPayout);

router.post('/beneficiaries', vimoController.createBeneficiary);
router.get('/beneficiaries', vimoController.listBeneficiaries);
router.put('/beneficiaries/:id', vimoController.updateBeneficiary);
router.delete('/beneficiaries/:id', vimoController.deleteBeneficiary);

router.post('/callback', vimoController.handleCallback);

module.exports = router;

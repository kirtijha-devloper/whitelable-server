const express = require('express');
const vimoController = require('../controllers/vimoController');
const validateToken = require('../middleware/validateTokenHandler');
const { ensureEmployeePermission } = require('../middleware/employeePermissionHandler');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const router = express.Router();

// Webhook callback should be open to Vimo provider; no user JWT required.
router.post('/callback', vimoController.handleCallback);

router.use(validateToken);

router.post('/auth/token', vimoController.fetchTokenStatus);
router.get('/auth/token', vimoController.fetchTokenStatus); // support GET for frontend convenience
router.get('/banks', vimoController.fetchBankList);
router.get('/purposes', vimoController.fetchPurposeList);
router.get('/states', vimoController.fetchStateList);
router.get('/balance', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.PAYOUT_READ), vimoController.getWalletBalance);

// Vimo payout and beneficiary management
router.get('/payout/reference', vimoController.getPayoutReference);
router.post('/payout', vimoController.createPayout);
router.post('/payout/status', vimoController.checkPayoutStatus);
router.get('/payout/status', vimoController.checkPayoutStatus);
router.get('/payout/audit-logs/by-reference', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.PAYOUT_READ), vimoController.getPayoutAuditLogsByReference);
router.post('/payout/admin/fail', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE), vimoController.failProcessingPayout);

router.post('/beneficiaries', vimoController.createBeneficiary);
router.get('/beneficiaries', vimoController.listBeneficiaries);
router.put('/beneficiaries/:id', vimoController.updateBeneficiary);
router.delete('/beneficiaries/:id', vimoController.deleteBeneficiary);

router.post('/callback', vimoController.handleCallback);

module.exports = router;

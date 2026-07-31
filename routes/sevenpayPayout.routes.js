const express = require('express');
const validateToken = require('../middleware/validateTokenHandler');
const { ensureEmployeePermission } = require('../middleware/employeePermissionHandler');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const sevenpayController = require('../controllers/sevenpayPayout.controller');

const router = express.Router();

router.use(validateToken);
router.use(ensureEmployeePermission([
  EMPLOYEE_PERMISSIONS.PAYOUT_READ,
  EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE,
]));

router.post('/auth/token', sevenpayController.login);
router.get('/auth/token', sevenpayController.login);
router.post('/auth/login', sevenpayController.login);
router.get('/payout/reference', sevenpayController.getPayoutReference);
router.post('/beneficiaries', sevenpayController.createBeneficiary);
router.get('/beneficiaries', sevenpayController.listBeneficiaries);
router.get('/beneficiaries/:merchant_id', sevenpayController.listBeneficiaries);
router.put('/beneficiaries/:id', sevenpayController.updateBeneficiary);
router.delete('/beneficiaries/:id', sevenpayController.deleteBeneficiary);
router.post('/payout', sevenpayController.initiatePayout);
router.post('/payout/initiate', sevenpayController.initiatePayout);
router.post('/payout/status', sevenpayController.getPayoutStatus);
router.get('/payout/status', sevenpayController.getPayoutStatus);
router.get('/payout/balance', sevenpayController.getWalletBalance);
router.post('/payout/balance', sevenpayController.getWalletBalance);
router.post('/payout/process-pending', sevenpayController.processPendingPayouts);
router.post('/payout/manual-refund', sevenpayController.manualRefundPayout);
router.get('/payout/audit-logs/by-payout', sevenpayController.getPayoutAuditLogsByPayout);

module.exports = router;

const express = require('express');
const router = express.Router();
const validateToken = require('../../middleware/validateTokenHandler');
const validateWhitelabelDomain = require('../../middleware/validateWhitelabelDomain');
const mxPayoutController = require('../../controllers/payments/mxPayoutController');
const { handleMxCallback } = require('../../controllers/payments/mxWebhookController');

// MeroRecharge webhook callback is public
router.post('/payout/callback', handleMxCallback);

router.use(validateToken);
router.use(validateWhitelabelDomain);

router.get('/payout/reference', mxPayoutController.getPayoutReference);
router.post('/beneficiaries', mxPayoutController.createBeneficiary);
router.get('/beneficiaries', mxPayoutController.listBeneficiaries);
router.get('/beneficiaries/:merchant_id', mxPayoutController.listBeneficiaries);
router.delete('/beneficiaries/:id', mxPayoutController.deleteBeneficiary);

router.post('/payout/initiate', mxPayoutController.initiatePayout);
router.post('/payout/status', mxPayoutController.getPayoutStatus);
router.get('/payout/status', mxPayoutController.getPayoutStatus);
router.post('/payout/manual-refund', mxPayoutController.manualRefundPayout);
router.get('/payout/audit-logs', mxPayoutController.getPayoutAuditLogsByPayout);

module.exports = router;

const express = require('express');
const branchxController = require('../../controllers/payments/branchxController');
const { handleBranchxPayoutCallback } = require('../../controllers/payments/branchxWebhookController');
const { getPayoutAuditLogs, getPayoutAuditLogsByRequest } = require('../../controllers/payments/branchxAuditController');

const router = express.Router();

const validateToken = require("../../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../../middleware/validateWhitelabelDomain");

// BranchX webhook callback endpoint is public (BranchX calls it on payout updates).
// It should be consumed by BranchX and not require user JWT auth.
router.post('/payout/callback', handleBranchxPayoutCallback);
router.get('/payout/callback', handleBranchxPayoutCallback);

router.use(validateToken);
router.use(validateWhitelabelDomain);

// Admin routes for payout audit logs.
router.get('/payout/audit-logs', getPayoutAuditLogs);
router.get('/payout/audit-logs/by-payout', getPayoutAuditLogsByRequest);

// All other BranchX routes require JWT auth.
router.use('', branchxController);

module.exports = router;
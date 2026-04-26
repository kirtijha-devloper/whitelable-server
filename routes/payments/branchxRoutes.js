const express = require('express');
const branchxController = require('../../controllers/payments/branchxController');
const { handleBranchxPayoutCallback } = require('../../controllers/payments/branchxWebhookController');
const { getPayoutAuditLogs } = require('../../controllers/payments/branchxAuditController');

const router = express.Router();

const validateToken = require("../../middleware/validateTokenHandler");

// BranchX webhook callback endpoint is public (BranchX calls it on payout updates).
// It should be consumed by BranchX and not require user JWT auth.
router.post('/payout/callback', handleBranchxPayoutCallback);
router.get('/payout/callback', handleBranchxPayoutCallback);

router.use(validateToken);

// Admin route for payout audit logs.
router.get('/payout/audit-logs', getPayoutAuditLogs);

// All other BranchX routes require JWT auth.
router.use('', branchxController);

module.exports = router;
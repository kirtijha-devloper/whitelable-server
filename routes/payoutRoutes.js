const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const { listPayoutBeneficiaries, updatePayoutBeneficiary } = require('../controllers/payoutController');
const ndia5Controller = require('../controllers/ndia5Payout.controller');

// Webhook callback should be open to NDIA5 provider; no user JWT required.
router.post('/ndia5/callback', ndia5Controller.handleCallback);
router.get('/ndia5/callback', ndia5Controller.handleCallback);

router.use(validateToken);

// GET /api/payout/beneficiaries
// Admin: all beneficiaries
// Merchant / Franchise: only beneficiaries created by the authenticated user
router.get('/beneficiaries', listPayoutBeneficiaries);

// PUT /api/payout/beneficiaries/:id
// Update a beneficiary record. Admin can update any beneficiary;
// merchant/franchise can update only their own.
router.put('/beneficiaries/:id', updatePayoutBeneficiary);

module.exports = router;

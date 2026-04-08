const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const { listPayoutBeneficiaries, updatePayoutBeneficiary } = require('../controllers/payoutController');

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

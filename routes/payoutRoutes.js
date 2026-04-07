const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const { listPayoutBeneficiaries } = require('../controllers/payoutController');

router.use(validateToken);

// GET /api/payout/beneficiaries
// Admin: all beneficiaries
// Merchant / Franchise: only beneficiaries created by the authenticated user
router.get('/beneficiaries', listPayoutBeneficiaries);

module.exports = router;

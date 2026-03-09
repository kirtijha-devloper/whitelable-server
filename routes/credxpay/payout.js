const express = require('express');
const payoutController = require('../../controllers/credxpay/payoutController');
const validateToken = require('../../middleware/validateTokenHandler');

const router = express.Router();

// apply JWT auth
router.use(validateToken);

// routes are mounted under /payout/credxpay
router.use('/', payoutController);

module.exports = router;
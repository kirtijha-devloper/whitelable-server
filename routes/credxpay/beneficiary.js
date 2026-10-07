const express = require('express');
const beneficiaryController = require('../../controllers/credxpay/beneficiaryController');
const validateToken = require('../../middleware/validateTokenHandler');
const validateWhitelabelDomain = require('../../middleware/validateWhitelabelDomain');

const router = express.Router();
router.use(validateToken);
router.use(validateWhitelabelDomain);
router.use('/', beneficiaryController);

module.exports = router;
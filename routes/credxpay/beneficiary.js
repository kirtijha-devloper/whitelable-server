const express = require('express');
const beneficiaryController = require('../../controllers/credxpay/beneficiaryController');
const validateToken = require('../../middleware/validateTokenHandler');

const router = express.Router();
router.use(validateToken);
router.use('/', beneficiaryController);

module.exports = router;
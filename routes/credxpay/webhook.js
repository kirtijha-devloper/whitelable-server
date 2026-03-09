const express = require('express');
const webhookController = require('../../controllers/credxpay/webhookController');

// webhooks should not require token
const router = express.Router();
router.use('/', webhookController);

module.exports = router;
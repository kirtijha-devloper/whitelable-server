const express = require('express');
const vimoController = require('../controllers/vimoController');
const validateToken = require('../middleware/validateTokenHandler');
const router = express.Router();

router.use(validateToken);

router.post('/auth/token', vimoController.fetchTokenStatus);
router.get('/banks', vimoController.fetchBankList);
router.get('/purposes', vimoController.fetchPurposeList);
router.get('/states', vimoController.fetchStateList);
router.post('/payout', vimoController.createPayout);
router.post('/callback', vimoController.handleCallback);

module.exports = router;

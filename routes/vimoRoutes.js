const express = require('express');
const vimoController = require('../controllers/vimoController');
const validateToken = require('../middleware/validateTokenHandler');
const router = express.Router();

// Webhook callback should be open to Vimo provider; no user JWT required.
router.post('/callback', vimoController.handleCallback);

router.use(validateToken);

router.post('/auth/token', vimoController.fetchTokenStatus);
router.get('/auth/token', vimoController.fetchTokenStatus); // support GET for frontend convenience
router.get('/banks', vimoController.fetchBankList);
router.get('/purposes', vimoController.fetchPurposeList);
router.get('/states', vimoController.fetchStateList);

// Vimo payout and beneficiary management
router.post('/payout', vimoController.createPayout);

router.post('/beneficiaries', vimoController.createBeneficiary);
router.get('/beneficiaries/:user_id', vimoController.listBeneficiaries);
router.put('/beneficiaries/:id', vimoController.updateBeneficiary);
router.delete('/beneficiaries/:id', vimoController.deleteBeneficiary);

router.post('/callback', vimoController.handleCallback);

module.exports = router;

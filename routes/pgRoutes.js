const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const validateWhitelabelDomain = require('../middleware/validateWhitelabelDomain');
const {
  createOrder,
  handleWebhook,
  getTransactions,
  getOrderStatus
} = require('../controllers/pgController');

// 1. Inbound S2S Webhooks (Public - Authenticated via Gateway Secret Headers)
router.post('/webhook/:gateway', handleWebhook);
router.post('/webhook', handleWebhook);
router.post('/pg1/webhook', (req, res, next) => {
  req.params.gateway = 'pg_1';
  handleWebhook(req, res, next);
});
router.post('/pg2/webhook', (req, res, next) => {
  req.params.gateway = 'pg_2';
  handleWebhook(req, res, next);
});
router.post('/pg3/webhook', (req, res, next) => {
  req.params.gateway = 'pg_2';
  handleWebhook(req, res, next);
});

// 2. Protected Routes (Require User JWT & Whitelabel Domain)
router.use(validateToken);
router.use(validateWhitelabelDomain);

router.post('/create-order', createOrder);
router.get('/transactions', getTransactions);
router.get('/order/:orderId', getOrderStatus);

module.exports = router;

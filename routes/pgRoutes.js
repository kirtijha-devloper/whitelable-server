const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const validateWhitelabelDomain = require('../middleware/validateWhitelabelDomain');
const {
  createOrder,
  handleWebhook,
  getTransactions,
  getOrderStatus,
  getChargeRules,
  getChargeRuleById,
  createChargeRule,
  updateChargeRule,
  deleteChargeRule,
  calculateCharge,
} = require('../controllers/pgController');

// 1. Inbound S2S Webhooks (Public - Authenticated via Gateway Secret Headers)
router.post('/webhook', handleWebhook);

// 2. Protected Routes (Require User JWT & Whitelabel Domain)
router.use(validateToken);
router.use(validateWhitelabelDomain);

router.post('/create-order', createOrder);
router.get('/transactions', getTransactions);
router.get('/order/:orderId', getOrderStatus);

// ── Charge Rule CRUD & Calculator ──────────────────────────────────────────
// GET    /api/pg/charge-rules           → list rules visible to caller (hierarchy-aware)
// GET    /api/pg/charge-rules/list      → list rules (alias for convenience)
// POST   /api/pg/charge-rules           → create a new rule
// POST   /api/pg/charge-rules/calculate → calculate PG MDR fee & GST
// GET    /api/pg/charge-rules/:id       → get single rule by ID
// PUT    /api/pg/charge-rules/:id       → update rule
// DELETE /api/pg/charge-rules/:id       → soft-delete rule
router.get('/charge-rules', getChargeRules);
router.get('/charge-rules/list', getChargeRules);
router.post('/charge-rules', createChargeRule);
router.post('/charge-rules/calculate', calculateCharge);
router.get('/charge-rules/:id', getChargeRuleById);
router.put('/charge-rules/:id', updateChargeRule);
router.delete('/charge-rules/:id', deleteChargeRule);

module.exports = router;

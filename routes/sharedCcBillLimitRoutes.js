const express = require('express');
const router = express.Router();
const {
  getSharedCcBillLimit,
  updateSharedCcBillLimit,
} = require('../controllers/sharedCcBillLimitController');
const validateToken = require('../middleware/validateTokenHandler');
const validateWhitelabelDomain = require('../middleware/validateWhitelabelDomain');

router.use(validateToken);
router.use(validateWhitelabelDomain);

// GET /api/shared-cc-bill-limit  - Read configured limit and current usage
router.get('/', getSharedCcBillLimit);

// PUT /api/shared-cc-bill-limit  - Update daily CC bill limit (Super Admin only)
router.put('/', updateSharedCcBillLimit);

module.exports = router;


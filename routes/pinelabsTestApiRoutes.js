const express = require('express');
const {
  uploadTransaction,
  getTransactionStatus,
  cancelTransaction,
  getHealth,
} = require('../controllers/pinelabsTestController');

const router = express.Router();

router.post('/pinelabs/upload', uploadTransaction);
router.post('/pinelabs/status', getTransactionStatus);
router.post('/pinelabs/cancel', cancelTransaction);
router.get('/pinelabs/health', getHealth);

module.exports = router;

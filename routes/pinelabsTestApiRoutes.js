const express = require('express');
const {
  uploadTransaction,
  getTransactionStatus,
  cancelTransaction,
} = require('../controllers/pinelabsTestController');

const router = express.Router();

router.post('/pinelabs/upload', uploadTransaction);
router.post('/pinelabs/status', getTransactionStatus);
router.post('/pinelabs/cancel', cancelTransaction);

module.exports = router;

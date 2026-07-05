const express = require('express');
const router = express.Router();

const {
  reconcileEndpointWorking,
} = require('../controllers/reconciliationController');

// GET /api/reconciliation
router.get('/', reconcileEndpointWorking);

module.exports = router;


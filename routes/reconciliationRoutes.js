const express = require('express');
const router = express.Router();
const verifyPartnerRequest = require("../middleware/verifyPartnerRequest");

const {
  reconcileEndpointWorking,
  reconcile,
} = require('../controllers/reconciliationController');

// GET /api/reconciliation (health check)
router.get('/', reconcileEndpointWorking);

// GET /api/reconciliation/reconcile
router.get('/reconcile', verifyPartnerRequest, reconcile);


module.exports = router;


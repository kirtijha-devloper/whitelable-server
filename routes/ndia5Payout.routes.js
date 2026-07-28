/**
 * =========================================================================
 * NDIA5 PAYOUT ROUTES
 * =========================================================================
 * Express router mapping NDIA5 Payout Gateway API endpoints.
 */

const express = require('express');
const validateToken = require('../middleware/validateTokenHandler');
const { ensureEmployeePermission } = require('../middleware/employeePermissionHandler');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const ndia5Controller = require('../controllers/ndia5Payout.controller');

const router = express.Router();

// Protect all NDIA5 payout routes with JWT authentication & employee permissions
router.use(validateToken);
router.use(ensureEmployeePermission([
  EMPLOYEE_PERMISSIONS.PAYOUT_READ,
  EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE,
]));

// Auth / Login endpoint
router.post('/auth/login', ndia5Controller.login);

// Self Balance Check endpoint
router.post('/payout/balance', ndia5Controller.getBalance);
router.get('/payout/balance', ndia5Controller.getBalance);

// Payout Initiate endpoints
router.post('/payout', ndia5Controller.initiatePayout);
router.post('/payout/initiate', ndia5Controller.initiatePayout);

// Payout Status Check endpoints
router.post('/payout/status', ndia5Controller.getPayoutStatus);
router.get('/payout/status', ndia5Controller.getPayoutStatus);

// Manual Refund endpoint (strictly manual, no automatic refunds)
router.post('/payout/manual-refund', ndia5Controller.manualRefundPayout);

// Audit logs endpoint
router.get('/payout/audit-logs/by-payout', ndia5Controller.getPayoutAuditLogsByPayout);

module.exports = router;

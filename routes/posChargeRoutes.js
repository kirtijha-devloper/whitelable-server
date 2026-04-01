const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const { ensureEmployeePermission } = require('../middleware/employeePermissionHandler');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const {
  createDefaultPosCharge,
  getDefaultPosCharges,
  updateDefaultPosCharge,
  deleteDefaultPosCharge,
  createUserPosCharge,
  getUserPosCharges,
  updateUserPosCharge,
  deleteUserPosCharge,
  calculatePosCharge,
  setGlobalPosRate,
  getGlobalPosRate,
  getRazorpayOptions
} = require('../controllers/posChargeController');

// All routes require authentication
router.use(validateToken);

// ── Default POS Charge slabs (write: admin only; read: all) ──────────────────
router.post('/default', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), createDefaultPosCharge);        // create
router.get('/default', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), getDefaultPosCharges);           // list all
router.put('/default/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), updateDefaultPosCharge);     // update
router.delete('/default/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), deleteDefaultPosCharge);  // delete

// ── User-specific POS Charges (admin + franchaise write; merchant read-only) ─
router.post('/user', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), createUserPosCharge);              // link / assign
router.get('/user', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), getUserPosCharges);                 // list (filtered by role)
router.put('/user/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), updateUserPosCharge);           // update link / override
router.delete('/user/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), deleteUserPosCharge);        // remove link

// ── Calculate effective POS charge ──────────────────────────────────────────
router.post('/calculate', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), calculatePosCharge);          // resolve effective charge + fee

// ── Razorpay notification value helpers (all authenticated roles)
router.get('/razorpay-options', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), getRazorpayOptions);    // distinct field values

// ── Global fallback POS rate (admin write; all read) ─────────────────────────
router.post('/global-rate', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), setGlobalPosRate);          // set / update (upsert)
router.get('/global-rate', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), getGlobalPosRate);           // get current global rate

module.exports = router;

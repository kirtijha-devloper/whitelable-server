const express = require('express');
const router = express.Router();

const validateToken = require('../middleware/validateTokenHandler');
const { ensureEmployeePermission } = require('../middleware/employeePermissionHandler');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const {
  createDefaultCommission,
  getDefaultCommissions,
  updateDefaultCommission,
  deleteDefaultCommission,
  createUserCommission,
  getUserCommissions,
  updateUserCommission,
  deleteUserCommission,
  getCommission
} = require('../controllers/commissionController');

// all routes require authentication
router.use(validateToken);

// Default (global) commission slabs — admin
router.post('/default', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), createDefaultCommission);         // create a slab
router.get('/default', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), getDefaultCommissions);           // list slabs
router.put('/default/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), updateDefaultCommission);     // update slab
router.delete('/default/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), deleteDefaultCommission);  // delete slab

// User-specific links (admin can manage, users can list their own)
router.post('/user', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), createUserCommission);              // link/create slab for user
router.get('/user', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), getUserCommissions);                 // list user links (query user_id optional)
router.put('/user/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), updateUserCommission);          // update a user-link
router.delete('/user/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), deleteUserCommission);       // remove link

// Lookup / calculate effective commission
router.post('/calculate', getCommission);                // returns best match + fee (if amount provided)

module.exports = router;

const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const { ensureEmployeePermission } = require('../middleware/employeePermissionHandler');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const {
  createServiceFee,
  getServiceFees,
  updateServiceFee,
  deleteServiceFee
} = require('../controllers/serviceFeeController');

// all routes require authentication
router.use(validateToken);

// admin-write, all-read
router.post('/', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), createServiceFee);
router.get('/', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), getServiceFees);
router.put('/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), updateServiceFee);
router.delete('/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), deleteServiceFee);

module.exports = router;

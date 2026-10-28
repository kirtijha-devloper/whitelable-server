const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const validateWhitelabelDomain = require('../middleware/validateWhitelabelDomain');
const { ensureEmployeePermission } = require('../middleware/employeePermissionHandler');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const {
  createUserPayoutCharge,
  listAllUserPayoutCharges,
  getUserPayoutChargesByUser,
  getCompanyPayoutCharges,
  getUserPayoutChargeById,
  updateUserPayoutCharge,
  deleteUserPayoutCharge,
} = require('../controllers/userPayoutChargeController');

router.use(validateToken);
router.use(validateWhitelabelDomain);

router.post('/', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage user payout charges.',
  elevateRole: 'admin',
}), createUserPayoutCharge);

router.get('/list', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view user payout charges.',
  elevateRole: 'admin',
}), listAllUserPayoutCharges);

router.get('/company/:companyId?', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view user payout charges.',
  elevateRole: 'admin',
}), getCompanyPayoutCharges);

router.get('/user', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view user payout charges.',
  elevateRole: 'admin',
}), getUserPayoutChargesByUser);

router.get('/user/:userId', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view user payout charges.',
  elevateRole: 'admin',
}), getUserPayoutChargesByUser);

router.get('/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view user payout charges.',
  elevateRole: 'admin',
}), getUserPayoutChargeById);

router.put('/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage user payout charges.',
  elevateRole: 'admin',
}), updateUserPayoutCharge);

router.delete('/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage user payout charges.',
  elevateRole: 'admin',
}), deleteUserPayoutCharge);

module.exports = router;

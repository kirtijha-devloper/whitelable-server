const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const { ensureEmployeePermission } = require('../middleware/employeePermissionHandler');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const {
  createPosChargeRule,
  getPosChargeRule,
  listPosChargeRules,
  listMerchantChargeRules,
  listFranchiseAdminRules,
  listFranchiseCustomRules,
  updatePosChargeRule,
  deletePosChargeRule,
  calculateCharge
} = require('../controllers/posChargeRuleController');
const { myChargesDebug } = require('../controllers/posChargeRuleDebugController');

router.use(validateToken);

// create / update / list / delete rules
router.post('/', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), createPosChargeRule);
// existing generic list remains for backward compatibility
router.get('/list', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), listPosChargeRules);
// merchant-specific grouped list
router.get('/list/merchant', listMerchantChargeRules);
// franchise helpers
router.get('/list/admin', listFranchiseAdminRules);
router.get('/list/franchise', listFranchiseCustomRules);
router.get('/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), getPosChargeRule);
router.put('/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), updatePosChargeRule);
router.delete('/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), deletePosChargeRule);

// calculation endpoint
router.post('/calculate', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), calculateCharge);

router.post('/my-charges_debug', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), myChargesDebug);

router.post('/my-charges-debug', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), myChargesDebug);

module.exports = router;

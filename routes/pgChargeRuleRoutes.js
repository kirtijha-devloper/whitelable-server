const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const validateWhitelabelDomain = require('../middleware/validateWhitelabelDomain');
const { ensureEmployeePermission } = require('../middleware/employeePermissionHandler');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const {
  createPgChargeRule,
  listPgChargeRules,
  listPgMerchantChargeRules,
  listPgFranchiseAdminRules,
  listPgFranchiseCustomRules,
  getPgChargeRule,
  updatePgChargeRule,
  deletePgChargeRule,
  calculatePgCharge
} = require('../controllers/pgChargeRuleController');

router.use(validateToken);
router.use(validateWhitelabelDomain);

// create PG charge rule
router.post('/', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), createPgChargeRule);

// generic list
router.get('/list', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), listPgChargeRules);

// merchant-specific grouped list
router.get('/list/merchant', listPgMerchantChargeRules);

// franchise helpers
router.get('/list/admin', listPgFranchiseAdminRules);
router.get('/list/franchise', listPgFranchiseCustomRules);

// calculate
router.post('/calculate', calculatePgCharge);

// single rule by ID
router.get('/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: 'You do not have permission to view rate settings.',
  elevateRole: 'admin',
}), getPgChargeRule);

router.put('/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), updatePgChargeRule);

router.delete('/:id', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: 'You do not have permission to manage rate settings.',
  elevateRole: 'admin',
}), deletePgChargeRule);

module.exports = router;


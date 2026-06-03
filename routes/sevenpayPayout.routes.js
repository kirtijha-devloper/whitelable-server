const express = require('express');
const validateToken = require('../middleware/validateTokenHandler');
const { ensureEmployeePermission } = require('../middleware/employeePermissionHandler');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const sevenpayController = require('../controllers/sevenpayPayout.controller');

const router = express.Router();

router.use(validateToken);
router.use(ensureEmployeePermission([
  EMPLOYEE_PERMISSIONS.PAYOUT_READ,
  EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE,
]));

router.post('/auth/login', sevenpayController.login);
router.post('/payout/initiate', sevenpayController.initiatePayout);
router.get('/payout/status', sevenpayController.getPayoutStatus);

module.exports = router;

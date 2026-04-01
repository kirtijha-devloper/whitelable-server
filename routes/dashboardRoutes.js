const express = require("express");
const router = express.Router();
const {  getDashboard, getTodayPayoutList} = require("../controllers/dashboardController");
const validateToken = require("../middleware/validateTokenHandler");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");
router.use(validateToken);

router.get("/today-payouts", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.PAYOUT_READ, {
  message: "You do not have permission to view payout data.",
  elevateRole: "admin",
}), getTodayPayoutList);
router.route("/").get( getDashboard );




module.exports = router;

const express = require("express");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");
const {
  createPayoutCharge,
  getPayoutCharge,
  listPayoutCharges,
  updatePayoutCharge,
  deletePayoutCharge
} = require("../controllers/payoutChargeController");

// Protect all routes with token validation
router.use(validateToken);

// Create Payout Charge
router.post("/", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), createPayoutCharge);

// List Payout Charges (with filters and pagination)
router.get("/list", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view rate settings.",
  elevateRole: "admin",
}), listPayoutCharges);

// Get Payout Charge by ID
router.get("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view rate settings.",
  elevateRole: "admin",
}), getPayoutCharge);

// Update Payout Charge
router.put("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), updatePayoutCharge);

// Delete Payout Charge
router.delete("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), deletePayoutCharge);

module.exports = router;


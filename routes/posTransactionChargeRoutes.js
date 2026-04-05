const express = require("express");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");
const {
  createPosTransactionCharge,
  getPosTransactionCharge,
  listPosTransactionCharges,
  updatePosTransactionCharge,
  deletePosTransactionCharge
} = require("../controllers/posTransactionChargeController");

// Protect all routes with token validation
router.use(validateToken);

// Create POS Transaction Charge
router.post("/", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), createPosTransactionCharge);

// List POS Transaction Charges (with filters and pagination)
router.get("/list", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view rate settings.",
  elevateRole: "admin",
}), listPosTransactionCharges);

// Get POS Transaction Charge by ID
router.get("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view rate settings.",
  elevateRole: "admin",
}), getPosTransactionCharge);

// Update POS Transaction Charge
router.put("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), updatePosTransactionCharge);

// Delete POS Transaction Charge
router.delete("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), deletePosTransactionCharge);

module.exports = router;


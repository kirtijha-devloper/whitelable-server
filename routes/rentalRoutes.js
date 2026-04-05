const express = require("express");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");
const {
  createRental,
  getRental,
  listRentals,
  updateRental,
  deleteRental
} = require("../controllers/rentalController");

// Protect all routes with token validation
router.use(validateToken);

// Create Rental
router.post("/", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), createRental);

// List Rentals (with filters and pagination)
router.get("/list", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view rate settings.",
  elevateRole: "admin",
}), listRentals);

// Get Rental by ID
router.get("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view rate settings.",
  elevateRole: "admin",
}), getRental);

// Update Rental
router.put("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), updateRental);

// Delete Rental
router.delete("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), deleteRental);

module.exports = router;


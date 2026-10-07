const express = require("express");
const router = express.Router();

const validateToken = require("../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../middleware/validateWhitelabelDomain");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");
const {
  createChargeType,
  getChargeTypes,
  createChargeSlab,
  getSlabsByCategory,
  updateChargeSlab,
  deleteChargeSlab,
  deleteChargeType,
  getSlabsById,
  getChargeSlabByUserId
} = require("../controllers/chargeController");

router.use(validateToken);
router.use(validateWhitelabelDomain);

// 🔁 Charge Type routes
router.post("/type", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), createChargeType);          // Create new charge type
router.get("/type", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view rate settings.",
  elevateRole: "admin",
}), getChargeTypes);             // Get all charge types
router.delete("/type/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), deleteChargeType);    // Delete a charge type by ID

// 📦 Charge Slab routes
router.post("/slab", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), createChargeSlab);          // Create new slab
router.post("/slab/list", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view rate settings.",
  elevateRole: "admin",
}), getSlabsByCategory);   // Get slabs by category + user_id from body
router.get("/slab/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view rate settings.",
  elevateRole: "admin",
}), getSlabsById);     // Get slab by ID
router.put("/slab/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), updateChargeSlab);       // Update slab
router.delete("/slab/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage rate settings.",
  elevateRole: "admin",
}), deleteChargeSlab);    // Delete slab
router.get("/slab/user/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view rate settings.",
  elevateRole: "admin",
}), getChargeSlabByUserId); // Get slabs on basis of user

module.exports = router;



module.exports = router;

const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMiddleware");

const {
  getAllPosMachine,
  createPosMachine,
  getPosMachine,
  activatePosMachine,
  deactivatePosMachine,
  unassignPosMachine,
  deletePosMachine,
  deleteAllPosMachines,
  markAsDelivered,
  markAsReturnInitiated,
  assignPosMachineToUserID,
  assignPosMachineToMerchant,
  getPosMachineList,
  getPosMachinesByUserId,
  updatePosMachine,
  bulkCreatePosMachines,
  assignPosMachineToSuperFranchise
} = require("../controllers/posMachineController");

const validateToken = require("../middleware/validateTokenHandler");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");

// 🛡️ Protect routes below this line (if needed)
router.use(validateToken);

// 🔍 Get all + paginated list
router.get("/", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_READ, {
  message: "You do not have permission to view stock POS data.",
  elevateRole: "admin",
}), getAllPosMachine);                 // admin use
router.get("/list", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_READ, {
  message: "You do not have permission to view stock POS data.",
  elevateRole: "admin",
}), getPosMachineList);            // role-based filtered list with pagination

// 🔎 Get POS machines assigned to a specific user
router.get("/assigned/:userId", ensureEmployeePermission([
  EMPLOYEE_PERMISSIONS.USERS_READ,
  EMPLOYEE_PERMISSIONS.USERS_LIST,
  EMPLOYEE_PERMISSIONS.STOCK_POS_READ,
], {
  message: "You do not have permission to view assigned POS machines.",
}), getPosMachinesByUserId);

// ➕ Create
router.post("/", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), createPosMachine);
router.post("/bulk-create", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), upload.single('file'), bulkCreatePosMachines); // Updated route with file upload

// 🔄 Activate/Deactivate
router.put("/activate/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), activatePosMachine);
router.put("/de-activate/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), deactivatePosMachine);
// 🔌 Unassign
router.put("/unassign/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), unassignPosMachine);

// 📦 Status updates
router.put("/delivered/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), markAsDelivered);
router.put("/returned-initiated/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), markAsReturnInitiated);



// 🎯 Assignments
router.post("/assign", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), assignPosMachineToUserID);
router.post("/assign-to-merchant", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), assignPosMachineToMerchant); // route to assign single machine to merchant

router.post("/assign-to-super-franchise", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), assignPosMachineToSuperFranchise); // route to assign single machine to super franchise

// ⚠️ TEMPORARY – delete ALL POS machines. Remove before production.
router.delete("/all", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), deleteAllPosMachines);

// 🧍 Get single, Delete
router.get("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_READ, {
  message: "You do not have permission to view stock POS data.",
  elevateRole: "admin",
}), getPosMachine);
router.delete("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), deletePosMachine);
router.put("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, {
  message: "You do not have permission to manage stock POS data.",
  elevateRole: "admin",
}), updatePosMachine);

module.exports = router;

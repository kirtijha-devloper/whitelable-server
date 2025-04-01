const express = require("express");
const router = express.Router();

const {
  getAllPosMachine,
  createPosMachine,
  getPosMachine,
  activatePosMachine,
  deactivatePosMachine,
  deletePosMachine,
  markAsDelivered,
  markAsReturnInitiated,
  assignPosMachineToFranchaise,
  assignPosMachineToMerhcant,
  getPosMachineList
} = require("../controllers/posMachineController");

const validateToken = require("../middleware/validateTokenHandler");

// 🛡️ Protect routes below this line (if needed)
router.use(validateToken);

// 🔍 Get all + paginated list
router.get("/", getAllPosMachine);                 // admin use
router.get("/list", getPosMachineList);            // role-based filtered list with pagination

// ➕ Create
router.post("/", createPosMachine);

// 🔄 Activate/Deactivate
router.put("/activate/:id", activatePosMachine);
router.put("/de-activate/:id", deactivatePosMachine);

// 📦 Status updates
router.put("/delivered/:id", markAsDelivered);
router.put("/returned-initiated/:id", markAsReturnInitiated);

// 🎯 Assignments
router.post("/assign-to-franchaise", assignPosMachineToFranchaise);
router.post("/assign-to-merchant", assignPosMachineToMerhcant);

// 🧍 Get single, Delete
router.get("/:id", getPosMachine);
router.delete("/:id", deletePosMachine);

module.exports = router;

const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMiddleware");

const {
  getAllPosMachine,
  createPosMachine,
  getPosMachine,
  activatePosMachine,
  deactivatePosMachine,
  deletePosMachine,
  markAsDelivered,
  markAsReturnInitiated,
  assignPosMachineToUserID,
  assignPosMachineToMerhcant,
  getPosMachineList,
  updatePosMachine,
  bulkCreatePosMachines
} = require("../controllers/posMachineController");

const validateToken = require("../middleware/validateTokenHandler");

// 🛡️ Protect routes below this line (if needed)
// router.use(validateToken);

// 🔍 Get all + paginated list
router.get("/", getAllPosMachine);                 // admin use
router.get("/list", getPosMachineList);            // role-based filtered list with pagination

// ➕ Create
router.post("/", createPosMachine);
router.post("/bulk-create", upload.single('file'), bulkCreatePosMachines); // Updated route with file upload

// 🔄 Activate/Deactivate
router.put("/activate/:id", activatePosMachine);
router.put("/de-activate/:id", deactivatePosMachine);

// 📦 Status updates
router.put("/delivered/:id", markAsDelivered);
router.put("/returned-initiated/:id", markAsReturnInitiated);



// 🎯 Assignments
router.post("/assign", assignPosMachineToUserID);
router.post("/assign-to-merchant", assignPosMachineToMerhcant); // Not in use

// 🧍 Get single, Delete
router.get("/:id", getPosMachine);
router.delete("/:id", deletePosMachine);
router.put("/:id", updatePosMachine);

module.exports = router;

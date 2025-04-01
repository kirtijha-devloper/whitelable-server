const express = require("express");
const router = express.Router();

const validateToken = require("../middleware/validateTokenHandler");
const {
  createChargeType,
  getChargeTypes,
  createChargeSlab,
  getSlabsByType,
  updateChargeSlab,
  deleteChargeSlab,
  deleteChargeType
} = require("../controllers/chargeController");

router.use(validateToken);

// 🔁 Charge Type routes
router.post("/type", createChargeType);          // Create new charge type
router.get("/type", getChargeTypes);             // Get all charge types
router.delete("/type/:id", deleteChargeType);    // Delete a charge type by ID

// 📦 Charge Slab routes
router.post("/slab", createChargeSlab);          // Create new slab
router.get("/slab/:typeId", getSlabsByType);     // Get slabs by charge type ID
router.put("/slab/:id", updateChargeSlab);       // Update slab
router.delete("/slab/:id", deleteChargeSlab);    // Delete slab

module.exports = router;



module.exports = router;
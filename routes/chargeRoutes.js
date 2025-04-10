const express = require("express");
const router = express.Router();

const validateToken = require("../middleware/validateTokenHandler");
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

// 🔁 Charge Type routes
router.post("/type", createChargeType);          // Create new charge type
router.get("/type", getChargeTypes);             // Get all charge types
router.delete("/type/:id", deleteChargeType);    // Delete a charge type by ID

// 📦 Charge Slab routes
router.post("/slab", createChargeSlab);          // Create new slab
router.post("/slab/list", getSlabsByCategory);   // Get slabs by category + user_id from body
router.get("/slab/:id", getSlabsById);     // Get slab by ID
router.put("/slab/:id", updateChargeSlab);       // Update slab
router.delete("/slab/:id", deleteChargeSlab);    // Delete slab
router.get("/slab/user/:id", getChargeSlabByUserId); // Get slabs

module.exports = router;



module.exports = router;
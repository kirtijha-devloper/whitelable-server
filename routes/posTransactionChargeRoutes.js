const express = require("express");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
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
router.post("/", createPosTransactionCharge);

// List POS Transaction Charges (with filters and pagination)
router.get("/list", listPosTransactionCharges);

// Get POS Transaction Charge by ID
router.get("/:id", getPosTransactionCharge);

// Update POS Transaction Charge
router.put("/:id", updatePosTransactionCharge);

// Delete POS Transaction Charge
router.delete("/:id", deletePosTransactionCharge);

module.exports = router;


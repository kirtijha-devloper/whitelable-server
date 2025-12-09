const express = require("express");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
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
router.post("/", createPayoutCharge);

// List Payout Charges (with filters and pagination)
router.get("/list", listPayoutCharges);

// Get Payout Charge by ID
router.get("/:id", getPayoutCharge);

// Update Payout Charge
router.put("/:id", updatePayoutCharge);

// Delete Payout Charge
router.delete("/:id", deletePayoutCharge);

module.exports = router;


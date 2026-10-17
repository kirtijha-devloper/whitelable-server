const express = require("express");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../middleware/validateWhitelabelDomain");
const {
  getAllServiceCharges,
  createServiceCharge,
  updateServiceCharge,
  deleteServiceCharge,
  toggleServiceChargeStatus,
  getMyApplicableCharges,
} = require("../controllers/serviceChargeController");

// Protect all service charge routes
router.use(validateToken);
router.use(validateWhitelabelDomain);

// 0. Inherited Base Rates for logged-in user
router.get("/my-applicable-charges", getMyApplicableCharges);

// 1. SET CHARGES (Super Admin / Admin)
// List all service charge rules
router.get("/", getAllServiceCharges);

// Create new slab/charge rule
router.post("/", createServiceCharge);

// Update existing rule
router.put("/:id", updateServiceCharge);

// Delete a rule
router.delete("/:id", deleteServiceCharge);

// Toggle active status
router.patch("/:id/status", toggleServiceChargeStatus);

module.exports = router;

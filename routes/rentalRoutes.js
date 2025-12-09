const express = require("express");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
const {
  createRental,
  getRental,
  listRentals,
  updateRental
} = require("../controllers/rentalController");

// Protect all routes with token validation
router.use(validateToken);

// Create Rental
router.post("/", createRental);

// List Rentals (with filters and pagination)
router.get("/list", listRentals);

// Get Rental by ID
router.get("/:id", getRental);

// Update Rental
router.put("/:id", updateRental);

module.exports = router;


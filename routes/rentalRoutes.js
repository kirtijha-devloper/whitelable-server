const express = require("express");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
const {
  createRental,
  getRental,
  listRentals,
  updateRental,
  deleteRental
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

// Delete Rental
router.delete("/:id", deleteRental);

module.exports = router;


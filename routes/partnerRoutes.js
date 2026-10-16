/**
 * partnerRoutes.js
 *
 * Dedicated route for third-party integration:
 * - POST /api/partner/create-machine (and /api/partner/pos-machine) - Create unassigned POS machine
 */

const express = require("express");
const router = express.Router();
const { validatePartnerSecurity } = require("../middleware/validatePartnerSecurity");
const { createPosMachine } = require("../controllers/partnerApiController");

// Apply IP and Domain validation and optional RSA signature verification middleware
router.use(validatePartnerSecurity);

// Single API to create unassigned POS Machine
router.post("/create-machine", createPosMachine);
router.post("/pos-machine", createPosMachine);

module.exports = router;

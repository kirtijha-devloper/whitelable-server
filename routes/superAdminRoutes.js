const express = require("express");
const validateToken = require("../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../middleware/validateWhitelabelDomain");
const {
  getSuperAdminData,
  getAdminDetails,
  createSuperAdmin,
  updateAdmin,
  updateAdminStatus,
  getSuperAdminPosInventory,
} = require("../controllers/superAdminController");

const routes = express.Router();
const router = express.Router();

// ── Super Admin Admins Listing ────────────────────────────────────────────────
router.get("/getAllAdmins", validateToken, validateWhitelabelDomain, getSuperAdminData);
router.get("/admin", validateToken, validateWhitelabelDomain, getSuperAdminData);
router.get("/", validateToken, validateWhitelabelDomain, getSuperAdminData);

module.exports = routes;
// ── Super Admin POS Inventory ────────────────────────────────────────────────
router.get("/getPosInventory", validateToken, validateWhitelabelDomain, getSuperAdminPosInventory);

// ── Super Admin Create Admin & Company ───────────────────────────────────────
router.post("/createAdmin", validateToken, validateWhitelabelDomain, createSuperAdmin);

// ── Super Admin Status Update ────────────────────────────────────────────────
router.patch("/admin/:id/status", validateToken, validateWhitelabelDomain, updateAdminStatus);

// ── Super Admin Single Admin Details ─────────────────────────────────────────
router.get("/admin/:id", validateToken, validateWhitelabelDomain, getAdminDetails);

// ── Super Admin Update Admin Profile & Company ───────────────────────────────
router.put("/admin/:id", validateToken, validateWhitelabelDomain, updateAdmin);

module.exports = router;
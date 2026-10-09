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
  getSuperAdminTransactionReport,
  getSuperAdminCommissionReport,
  getSuperAdminServiceWiseReport,
} = require("../controllers/superAdminController");
const {
  getPosInventory,
  addPosInventory,
  getQrInventory,
  addQrInventory,
  getPgInventory,
  addPgInventory,
} = require("../controllers/inventoryController");
const {
  getServicesListController,
  updateServiceStatusController,
  createServiceController,
  getServiceSettings,
  updateServiceSettings,
} = require("../controllers/serviceSettingsController");
const serviceChargeRoutes = require("./serviceChargeRoutes");
const posChargeRuleRoutes = require("./posChargeRuleRoutes");
const payoutChargeRoutes = require("./payoutChargeRoutes");
const userPayoutChargeRoutes = require("./userPayoutChargeRoutes");
const chargeRoutes = require("./chargeRoutes");
const serviceFeeRoutes = require("./serviceFeeRoutes");
const commissionRoutes = require("./commissionRoutes");

const router = express.Router();

// ── Rate & Charge Settings for Super Admin ─────────────────────────────────
router.use("/service-charges", serviceChargeRoutes);
router.use("/rate-settings/pos", posChargeRuleRoutes);
router.use("/pos-charge-rules", posChargeRuleRoutes);
router.use("/rate-settings/payout", payoutChargeRoutes);
router.use("/payout-charges", payoutChargeRoutes);
router.use("/rate-settings/user-payout", userPayoutChargeRoutes);
router.use("/user-payout-charges", userPayoutChargeRoutes);
router.use("/rate-settings/slabs", chargeRoutes);
router.use("/charge-slabs", chargeRoutes);
router.use("/rate-settings/service-fees", serviceFeeRoutes);
router.use("/service-fees", serviceFeeRoutes);
router.use("/rate-settings/commissions", commissionRoutes);
router.use("/commissions", commissionRoutes);

// ── Service Management APIs ──────────────────────────────────────────────────
router.get("/services", validateToken, validateWhitelabelDomain, getServicesListController);
router.get("/service-settings", validateToken, validateWhitelabelDomain, getServicesListController);
router.put("/services/:key/status", validateToken, validateWhitelabelDomain, updateServiceStatusController);
router.put("/services/status", validateToken, validateWhitelabelDomain, updateServiceStatusController);
router.post("/services/create", validateToken, validateWhitelabelDomain, createServiceController);
router.post("/services", validateToken, validateWhitelabelDomain, createServiceController);

// ── Inventory APIs ────────────────────────────────────────────────────────────
// POS Inventory
router.get("/getPosInventory", validateToken, validateWhitelabelDomain, getPosInventory);
router.get("/inventory/pos", validateToken, validateWhitelabelDomain, getPosInventory);
router.post("/addPosInventory", validateToken, validateWhitelabelDomain, addPosInventory);
router.post("/inventory/pos", validateToken, validateWhitelabelDomain, addPosInventory);

// QR Inventory
router.get("/getQrInventory", validateToken, validateWhitelabelDomain, getQrInventory);
router.get("/inventory/qr", validateToken, validateWhitelabelDomain, getQrInventory);
router.post("/addQrInventory", validateToken, validateWhitelabelDomain, addQrInventory);
router.post("/inventory/qr", validateToken, validateWhitelabelDomain, addQrInventory);

// PG Inventory
router.get("/getPgInventory", validateToken, validateWhitelabelDomain, getPgInventory);
router.get("/inventory/pg", validateToken, validateWhitelabelDomain, getPgInventory);
router.post("/addPgInventory", validateToken, validateWhitelabelDomain, addPgInventory);
router.post("/inventory/pg", validateToken, validateWhitelabelDomain, addPgInventory);

// ── Super Admin Admins Listing ────────────────────────────────────────────────
router.get("/getAllAdmins", validateToken, validateWhitelabelDomain, getSuperAdminData);
router.get("/admin", validateToken, validateWhitelabelDomain, getSuperAdminData);

// ── Super Admin Create Admin & Company ───────────────────────────────────────
router.post("/createAdmin", validateToken, validateWhitelabelDomain, createSuperAdmin);

// ── Super Admin Status Update ────────────────────────────────────────────────
router.patch("/admin/:id/status", validateToken, validateWhitelabelDomain, updateAdminStatus);
router.put("/admin/:id/status", validateToken, validateWhitelabelDomain, updateAdminStatus);
router.patch("/:id/status", validateToken, validateWhitelabelDomain, updateAdminStatus);
router.put("/:id/status", validateToken, validateWhitelabelDomain, updateAdminStatus);

// ── Super Admin Single Admin Details ─────────────────────────────────────────
router.get("/admin/:id", validateToken, validateWhitelabelDomain, getAdminDetails);
router.get("/:id", validateToken, validateWhitelabelDomain, getAdminDetails);

// ── Super Admin Update Admin Profile & Company ───────────────────────────────
router.put("/admin/:id", validateToken, validateWhitelabelDomain, updateAdmin);
router.patch("/admin/:id", validateToken, validateWhitelabelDomain, updateAdmin);
router.put("/:id", validateToken, validateWhitelabelDomain, updateAdmin);
router.patch("/:id", validateToken, validateWhitelabelDomain, updateAdmin);

// ── Super Admin Reports ───────────────────────────────────────────────────────
router.get("/reports/transactions", validateToken, validateWhitelabelDomain, getSuperAdminTransactionReport);
router.get("/reports/commissions", validateToken, validateWhitelabelDomain, getSuperAdminCommissionReport);
router.get("/reports/service-wise", validateToken, validateWhitelabelDomain, getSuperAdminServiceWiseReport);

router.get("/", validateToken, validateWhitelabelDomain, getSuperAdminData);

module.exports = router;
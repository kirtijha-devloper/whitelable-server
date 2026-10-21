const express = require("express");
const validateToken = require("../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../middleware/validateWhitelabelDomain");
const {
  getSuperAdminData,
  getAdminDetails,
  getAdminServicesController,
  createSuperAdmin,
  updateAdmin,
  updateAdminStatus,
  getSuperAdminPosInventory,
  getSuperAdminTransactionReport,
  getSuperAdminCommissionReport,
  getSuperAdminServiceWiseReport,
  getSuperAdminDashboard,
  superAdminCreditAdminWallet,
  superAdminDebitAdminWallet,
  // Rate setting controllers
  getSuperAdminPosDefaults,
  createSuperAdminPosDefault,
  updateSuperAdminPosDefault,
  deleteSuperAdminPosDefault,
  getSuperAdminPosAdminsMatrix,
  getSuperAdminPosAdminRates,
  createOrUpdateSuperAdminPosAdminRate,
  updateSuperAdminPosAdminRate,
  deleteSuperAdminPosAdminRate,
  getSuperAdminRentalRates,
  createSuperAdminRentalRate,
  updateSuperAdminRentalRate,
  deleteSuperAdminRentalRate,
  getSuperAdminCcBillRules,
  createSuperAdminCcBillRule,
  updateSuperAdminCcBillRule,
  deleteSuperAdminCcBillRule,
  getSuperAdminPayoutRules,
  createSuperAdminPayoutRule,
  updateSuperAdminPayoutRule,
  deleteSuperAdminPayoutRule,
  getSuperAdminGlobalPosRate,
  updateSuperAdminGlobalPosRate,
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

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== "super_admin") {
    return res.status(403).json({ success: false, message: "Super Admin access only." });
  }
  return next();
}

// Super Admin Dashboard Route ________________________________________________

router.get("/dashboard", validateToken, validateWhitelabelDomain, getSuperAdminDashboard);

// ── Rate & Charge Settings for Super Admin ─────────────────────────────────
// 1. Platform Default POS Rates (Super Admin baseline)
router.get("/rate-settings/pos/defaults", validateToken, validateWhitelabelDomain, requireSuperAdmin, getSuperAdminPosDefaults);
router.post("/rate-settings/pos/defaults", validateToken, validateWhitelabelDomain, requireSuperAdmin, createSuperAdminPosDefault);
router.put("/rate-settings/pos/defaults/:id", validateToken, validateWhitelabelDomain, requireSuperAdmin, updateSuperAdminPosDefault);
router.delete("/rate-settings/pos/defaults/:id", validateToken, validateWhitelabelDomain, requireSuperAdmin, deleteSuperAdminPosDefault);

// 2. Admin-Specific POS Rates (Matrix, Detail, Overrides, Reset)
router.get("/rate-settings/pos/admins", validateToken, validateWhitelabelDomain, requireSuperAdmin, getSuperAdminPosAdminsMatrix);
router.get("/rate-settings/pos/admin/:adminId", validateToken, validateWhitelabelDomain, requireSuperAdmin, getSuperAdminPosAdminRates);
router.post("/rate-settings/pos/admin/:adminId", validateToken, validateWhitelabelDomain, requireSuperAdmin, createOrUpdateSuperAdminPosAdminRate);
router.put("/rate-settings/pos/admin/rule/:id", validateToken, validateWhitelabelDomain, requireSuperAdmin, updateSuperAdminPosAdminRate);
router.delete("/rate-settings/pos/admin/rule/:id", validateToken, validateWhitelabelDomain, requireSuperAdmin, deleteSuperAdminPosAdminRate);

// 3. POS Rental Rates
router.get("/rate-settings/rental", validateToken, validateWhitelabelDomain, requireSuperAdmin, getSuperAdminRentalRates);
router.post("/rate-settings/rental", validateToken, validateWhitelabelDomain, requireSuperAdmin, createSuperAdminRentalRate);
router.put("/rate-settings/rental/:id", validateToken, validateWhitelabelDomain, requireSuperAdmin, updateSuperAdminRentalRate);
router.delete("/rate-settings/rental/:id", validateToken, validateWhitelabelDomain, requireSuperAdmin, deleteSuperAdminRentalRate);

// 4. CC Bill Pay (BBPS) Charges
router.get("/rate-settings/cc-bill", validateToken, validateWhitelabelDomain, requireSuperAdmin, getSuperAdminCcBillRules);
router.post("/rate-settings/cc-bill", validateToken, validateWhitelabelDomain, requireSuperAdmin, createSuperAdminCcBillRule);
router.put("/rate-settings/cc-bill/:id", validateToken, validateWhitelabelDomain, requireSuperAdmin, updateSuperAdminCcBillRule);
router.delete("/rate-settings/cc-bill/:id", validateToken, validateWhitelabelDomain, requireSuperAdmin, deleteSuperAdminCcBillRule);

// 5. Payout Charges
router.get("/rate-settings/payout", validateToken, validateWhitelabelDomain, requireSuperAdmin, getSuperAdminPayoutRules);
router.post("/rate-settings/payout", validateToken, validateWhitelabelDomain, requireSuperAdmin, createSuperAdminPayoutRule);
router.put("/rate-settings/payout/:id", validateToken, validateWhitelabelDomain, requireSuperAdmin, updateSuperAdminPayoutRule);
router.delete("/rate-settings/payout/:id", validateToken, validateWhitelabelDomain, requireSuperAdmin, deleteSuperAdminPayoutRule);

// 6. Universal Fallback POS Rate
router.get("/rate-settings/global-rate", validateToken, validateWhitelabelDomain, requireSuperAdmin, getSuperAdminGlobalPosRate);
router.post("/rate-settings/global-rate", validateToken, validateWhitelabelDomain, requireSuperAdmin, updateSuperAdminGlobalPosRate);

// ── Legacy Sub-Routers Mounting (Maintained for backward compatibility) ────
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

// ── Super Admin Admin Wallet Credit / Debit ──────────────────────────────────
router.post("/wallet/credit", validateToken, validateWhitelabelDomain, superAdminCreditAdminWallet);
router.post("/wallet/debit", validateToken, validateWhitelabelDomain, superAdminDebitAdminWallet);
router.post("/admin/:id/wallet/credit", validateToken, validateWhitelabelDomain, superAdminCreditAdminWallet);
router.post("/:id/wallet/credit", validateToken, validateWhitelabelDomain, superAdminCreditAdminWallet);
router.post("/admin/:id/wallet/debit", validateToken, validateWhitelabelDomain, superAdminDebitAdminWallet);
router.post("/:id/wallet/debit", validateToken, validateWhitelabelDomain, superAdminDebitAdminWallet);

// ── Super Admin Admin-Wise Services ─────────────────────────────────────────
router.get("/admin/:id/services", validateToken, validateWhitelabelDomain, getAdminServicesController);
router.get("/:id/services", validateToken, validateWhitelabelDomain, getAdminServicesController);

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
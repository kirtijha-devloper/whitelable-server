const express = require("express");
const router = express.Router();
const { getAdminDashboard, getUnassignedMerchants, setUserIpayOutletId, setUserSettlementType, setAllUsersSettlementType } = require("../controllers/adminController");
const { adminDirectCredit, adminDirectDebit, reconcileWallet, reconcileAllWallets } = require("../controllers/adminWalletController");
const {
  getServiceSettings,
  updateServiceSettings,
  updateUserServiceSettings,
} = require("../controllers/serviceSettingsController");
const {
  createLoginPopup,
  listLoginPopupsForAdmin,
  updateLoginPopup,
  deleteLoginPopup,
} = require("../controllers/loginPopupController");
const { listLogFiles, downloadLogFile } = require("../controllers/logController");
const { loginPopupUpload } = require("../middleware/loginPopupUpload");
const validateToken = require("../middleware/validateTokenHandler");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");

router.route("/").get(getAdminDashboard);

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access only." });
  }

  return next();
}

// GET /api/admin/merchants/unassigned
//   Returns merchants with no franchise (franchaise_id IS NULL)
//   Query: page, limit, status, search
router.get("/merchants/unassigned", validateToken, ensureEmployeePermission(EMPLOYEE_PERMISSIONS.USERS_LIST, {
  message: "You do not have permission to view user data.",
  elevateRole: "admin",
}), getUnassignedMerchants);

// ── Admin wallet adjustments (admin-only, protected) ─────────────────────────
// POST /api/admin/wallet/credit
//   Body: { user_id, amount, reason?, idempotency_key }
router.post("/wallet/credit", validateToken, ensureEmployeePermission(EMPLOYEE_PERMISSIONS.WALLET_CREDIT, {
  message: "You do not have permission to credit wallet balances.",
  elevateRole: "admin",
}), adminDirectCredit);

// POST /api/admin/wallet/debit
//   Body: { user_id, amount, reason?, idempotency_key }
router.post("/wallet/debit", validateToken, ensureEmployeePermission(EMPLOYEE_PERMISSIONS.WALLET_DEBIT, {
  message: "You do not have permission to debit wallet balances.",
  elevateRole: "admin",
}), adminDirectDebit);

// PUT /api/admin/user/:id/ipay-outlet
//   Admin-only: set or update the InstantPay outlet ID for any user.
router.put("/user/:id/ipay-outlet", validateToken, setUserIpayOutletId);

// PUT /api/admin/users/settlement-type
//   Admin-only: update settlement type for all merchant and franchise users.
//   Body: { settlement_type: 'today_settlement' | 'next_day_settlement' }
router.put("/users/settlement-type", validateToken, requireAdmin, setAllUsersSettlementType);

// PUT /api/admin/user/:id/settlement-type
//   Admin-only: update settlement type for a single merchant or franchise user.
//   Body: { settlement_type: 'today_settlement' | 'next_day_settlement' }
router.put("/user/:id/settlement-type", validateToken, requireAdmin, setUserSettlementType);

// POST /api/admin/wallet/reconcile/:userId
//   Recomputes balance from SUM(credit)-SUM(debit) and fixes user.wallet if drifted.
//   Run this after any manual insert/delete in the Ledgers table.
router.post("/wallet/reconcile/:userId", validateToken, ensureEmployeePermission([
  EMPLOYEE_PERMISSIONS.WALLET_CREDIT,
  EMPLOYEE_PERMISSIONS.WALLET_DEBIT,
], {
  message: "You do not have permission to manage wallet operations.",
  elevateRole: "admin",
}), reconcileWallet);

// POST /api/admin/wallet/reconcile-all
//   Reconciles ALL active users' wallets in one call.
//   Run after bulk DB operations or migrations that may affect many users.
router.post("/wallet/reconcile-all", validateToken, ensureEmployeePermission([
  EMPLOYEE_PERMISSIONS.WALLET_CREDIT,
  EMPLOYEE_PERMISSIONS.WALLET_DEBIT,
], {
  message: "You do not have permission to manage wallet operations.",
  elevateRole: "admin",
}), reconcileAllWallets);

router.get("/service-settings", validateToken, ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view service settings.",
  elevateRole: "admin",
}), getServiceSettings);

router.put("/service-settings", validateToken, ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage service settings.",
  elevateRole: "admin",
}), updateServiceSettings);

router.put("/user/:id/service-settings", validateToken, ensureEmployeePermission(EMPLOYEE_PERMISSIONS.USERS_SERVICE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage user service settings.",
  elevateRole: "admin",
}), updateUserServiceSettings);

router.get("/login-popups", validateToken, listLoginPopupsForAdmin);
router.post("/login-popups", validateToken, loginPopupUpload, createLoginPopup);
router.put("/login-popups/:id", validateToken, loginPopupUpload, updateLoginPopup);
router.delete("/login-popups/:id", validateToken, deleteLoginPopup);

router.get("/logs", validateToken, ensureEmployeePermission(EMPLOYEE_PERMISSIONS.SYSTEM_LOGS_READ, {
  message: "You do not have permission to view server logs.",
  elevateRole: "admin",
}), requireAdmin, listLogFiles);

router.get("/logs/:filename/download", validateToken, ensureEmployeePermission(EMPLOYEE_PERMISSIONS.SYSTEM_LOGS_READ, {
  message: "You do not have permission to view server logs.",
  elevateRole: "admin",
}), requireAdmin, downloadLogFile);

module.exports = router;

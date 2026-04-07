const express = require("express");
const router = express.Router();
const { getAdminDashboard, getUnassignedMerchants } = require("../controllers/adminController");
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
const { loginPopupUpload } = require("../middleware/loginPopupUpload");
const validateToken = require("../middleware/validateTokenHandler");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");

router.route("/").get(getAdminDashboard);

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

// POST /api/admin/wallet/reconcile/:userId
//   Recomputes balance from SUM(credit)-SUM(debit) and fixes user.wallet if drifted.
//   Run this after any manual insert/delete in the Ledgers table.
router.post("/wallet/reconcile/:userId", validateToken, reconcileWallet);

// POST /api/admin/wallet/reconcile-all
//   Reconciles ALL active users' wallets in one call.
//   Run after bulk DB operations or migrations that may affect many users.
router.post("/wallet/reconcile-all", validateToken, reconcileAllWallets);

router.get("/service-settings", validateToken, ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, {
  message: "You do not have permission to view service settings.",
  elevateRole: "admin",
}), getServiceSettings);

router.put("/service-settings", validateToken, ensureEmployeePermission(EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, {
  message: "You do not have permission to manage service settings.",
  elevateRole: "admin",
}), updateServiceSettings);

router.put("/user/:id/service-settings", validateToken, updateUserServiceSettings);

router.get("/login-popups", validateToken, listLoginPopupsForAdmin);
router.post("/login-popups", validateToken, loginPopupUpload, createLoginPopup);
router.put("/login-popups/:id", validateToken, loginPopupUpload, updateLoginPopup);
router.delete("/login-popups/:id", validateToken, deleteLoginPopup);

module.exports = router;

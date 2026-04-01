const express = require("express");
const router = express.Router();
const {
  getPosTransactionReport,
  getWalletReport,
  getRazorpayNotificationReport,
  getLedgerReport,
  getPayoutReport,
  getBbpsReport,
  getAllTransactionsReport,
  getAllRazorpayNotifications,
  getUserReport
} = require("../controllers/reportController");

const validateToken = require("../middleware/validateTokenHandler");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");

// 🛡️ Protect routes below this line (if needed)
router.use(validateToken);

router.get("/pos-txn", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.REPORTS_READ, {
  message: "You do not have permission to view reports.",
  elevateRole: "admin",
}), getPosTransactionReport);
router.get("/wallet", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.REPORTS_READ, {
  message: "You do not have permission to view reports.",
  elevateRole: "admin",
}), getWalletReport);
router.get("/razorpay", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.REPORTS_READ, {
  message: "You do not have permission to view reports.",
  elevateRole: "admin",
}), getRazorpayNotificationReport); // User-wise Razorpay notification report
// Admin investigation: unfiltered list ordered by id desc
router.get("/razorpay/all", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.REPORTS_READ, {
  message: "You do not have permission to view reports.",
  elevateRole: "admin",
}), getAllRazorpayNotifications);

// ledger report: date range and role‑scoped
router.get("/ledger", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.REPORTS_READ, {
  message: "You do not have permission to view reports.",
  elevateRole: "admin",
}), getLedgerReport);

// payout report: balance_before / amount / balance_after per payout
router.get("/payout", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.PAYOUT_READ, {
  message: "You do not have permission to view payout data.",
  elevateRole: "admin",
}), getPayoutReport);

// BBPS CC bill payment report
router.get("/bbps", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.REPORTS_READ, {
  message: "You do not have permission to view reports.",
  elevateRole: "admin",
}), getBbpsReport);

// combined: Razorpay + Payout + BBPS + Direct Transfer, ordered by date
router.get("/all-transactions", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.REPORTS_READ, {
  message: "You do not have permission to view reports.",
  elevateRole: "admin",
}), getAllTransactionsReport);

// ── User listing/reporting ───────────────────────────────────────────────
// Admins may filter across all users; franchisees only see their own merchants.
router.get("/users", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.REPORTS_READ, {
  message: "You do not have permission to view reports.",
  elevateRole: "admin",
}), getUserReport);


module.exports = router;

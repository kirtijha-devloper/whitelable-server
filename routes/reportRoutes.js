const express = require("express");
const router = express.Router();
const {
  getPosTransactionReport,
  getWalletReport,
  getRazorpayNotificationReport,
  getAllRazorpayNotifications,
  getUserReport
} = require("../controllers/reportController");

const validateToken = require("../middleware/validateTokenHandler");

// 🛡️ Protect routes below this line (if needed)
router.use(validateToken);

router.get("/pos-txn", getPosTransactionReport);
router.get("/wallet", getWalletReport);
router.get("/razorpay", getRazorpayNotificationReport); // User-wise Razorpay notification report
// Admin investigation: unfiltered list ordered by id desc
router.get("/razorpay/all", getAllRazorpayNotifications);

// ── User listing/reporting ───────────────────────────────────────────────
// Admins may filter across all users; franchisees only see their own merchants.
router.get("/users", getUserReport);


module.exports = router;
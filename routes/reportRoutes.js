const express = require("express");
const router = express.Router();
const { getPosTransactionReport, getWalletReport, getRazorpayNotificationReport
} = require("../controllers/reportController");

const validateToken = require("../middleware/validateTokenHandler");

// 🛡️ Protect routes below this line (if needed)
router.use(validateToken);

router.get("/pos-txn", getPosTransactionReport);
router.get("/wallet", getWalletReport);
router.get("/razorpay", getRazorpayNotificationReport); // User-wise Razorpay notification report

module.exports = router;
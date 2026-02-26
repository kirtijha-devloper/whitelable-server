const express = require("express");
const router = express.Router();
const { getAdminDashboard } = require("../controllers/adminController");
const { adminDirectCredit, adminDirectDebit } = require("../controllers/adminWalletController");
const validateToken = require("../middleware/validateTokenHandler");

router.route("/").get(getAdminDashboard);

// ── Admin wallet adjustments (admin-only, protected) ─────────────────────────
// POST /api/admin/wallet/credit
//   Body: { user_id, amount, reason?, idempotency_key }
router.post("/wallet/credit", validateToken, adminDirectCredit);

// POST /api/admin/wallet/debit
//   Body: { user_id, amount, reason?, idempotency_key }
router.post("/wallet/debit", validateToken, adminDirectDebit);

module.exports = router;
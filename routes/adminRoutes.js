const express = require("express");
const router = express.Router();
const { getAdminDashboard, getUnassignedMerchants } = require("../controllers/adminController");
const { adminDirectCredit, adminDirectDebit, reconcileWallet } = require("../controllers/adminWalletController");
const validateToken = require("../middleware/validateTokenHandler");

router.route("/").get(getAdminDashboard);

// GET /api/admin/merchants/unassigned
//   Returns merchants with no franchise (franchaise_id IS NULL)
//   Query: page, limit, status, search
router.get("/merchants/unassigned", validateToken, getUnassignedMerchants);

// ── Admin wallet adjustments (admin-only, protected) ─────────────────────────
// POST /api/admin/wallet/credit
//   Body: { user_id, amount, reason?, idempotency_key }
router.post("/wallet/credit", validateToken, adminDirectCredit);

// POST /api/admin/wallet/debit
//   Body: { user_id, amount, reason?, idempotency_key }
router.post("/wallet/debit", validateToken, adminDirectDebit);

// POST /api/admin/wallet/reconcile/:userId
//   Recomputes balance from SUM(credit)-SUM(debit) and fixes user.wallet if drifted.
//   Run this after any manual insert/delete in the Ledgers table.
router.post("/wallet/reconcile/:userId", validateToken, reconcileWallet);

module.exports = router;
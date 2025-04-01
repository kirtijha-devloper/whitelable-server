const express = require("express");
const router = express.Router();
const {
  requestFund,
  transferFund,
  holdFund,
  unholdFund,
  getWalletRequests,
  getTransactionsByRole
} = require("../controllers/walletTransactionController");

const validateToken = require("../middleware/validateTokenHandler");

router.use(validateToken);

router.post("/request", requestFund);
router.post("/transer", transferFund)
router.post("/hold", holdFund);
router.post("/unhold", unholdFund);
router.get("/requests", getWalletRequests);
router.get("list", getTransactionsByRole)

module.exports = router;

const express = require("express");
const router = express.Router();
const {
  requestFund,
  transferFund,
  holdFund,
  unholdFund,
  getWalletRequests,
  getTransactionsByRole,
  getWalletRequestById,
  getUserWalletTransactions,
  getSingleTransactionHistory
} = require("../controllers/walletTransactionController");

const validateToken = require("../middleware/validateTokenHandler");

router.use(validateToken);

router.post("/request", requestFund);
router.post("/transer/:id", transferFund)
router.post("/hold/:id", holdFund);
router.post("/unhold/:id", unholdFund);
router.post("/filter", getUserWalletTransactions)
router.get("/requests", getWalletRequests);
router.get("/list", getTransactionsByRole)
router.get("/history/:id", getSingleTransactionHistory)
router.get("/:id", getWalletRequestById)


module.exports = router;

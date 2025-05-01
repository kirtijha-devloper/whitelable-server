const express = require("express");
const router = express.Router();
const { getPosTransactionReport, getWalletReport
} = require("../controllers/reportController");

const validateToken = require("../middleware/validateTokenHandler");

// 🛡️ Protect routes below this line (if needed)
router.use(validateToken);

router.get("/pos-txn", getPosTransactionReport);
router.get("/wallet", getWalletReport);


module.exports = router;
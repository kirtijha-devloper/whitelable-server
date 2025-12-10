const express = require("express");
const upload = require("../utils/mutlerSetup")

const { listStatement, getLedgerEntries} = require("../controllers/ledgerController");

const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
router.use(validateToken)

router.get("/statement/list", listStatement);
router.get("/entries", getLedgerEntries); // Get ledger entries with debit/credit and running balance





module.exports = router;
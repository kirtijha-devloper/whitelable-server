const express = require("express");
const upload = require("../utils/mutlerSetup")

const { listStatement, getLedgerEntries, getLedgerEntryDetails } = require("../controllers/ledgerController");

const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
router.use(validateToken)

router.get("/statement/list", listStatement);
router.get("/entries", getLedgerEntries);         // Passbook list: debit, credit, balance_before, balance_after
router.get("/entries/:id", getLedgerEntryDetails); // Single entry with full linked source record

module.exports = router;
module.exports = router;
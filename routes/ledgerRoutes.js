const express = require("express");
const upload = require("../utils/mutlerSetup")

const { listStatement, getLedgerEntries, getLedgerEntryDetails, manualRefundLedgerEntry } = require("../controllers/ledgerController");

const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");
router.use(validateToken)

router.get("/statement/list", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.LEDGER_READ, {
  message: "You do not have permission to view ledger data.",
  elevateRole: "admin",
}), listStatement);
router.get("/entries", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.LEDGER_READ, {
  message: "You do not have permission to view ledger data.",
  elevateRole: "admin",
}), getLedgerEntries);         // Passbook list: debit, credit, balance_before, balance_after
router.get("/entries/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.LEDGER_READ, {
  message: "You do not have permission to view ledger data.",
  elevateRole: "admin",
}), getLedgerEntryDetails); // Single entry with full linked source record
router.post("/entries/:id/manual-refund", ensureEmployeePermission([
  EMPLOYEE_PERMISSIONS.LEDGER_MANAGE,
  EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE,
], {
  message: "You do not have permission to manage ledger refunds.",
  elevateRole: "admin",
}), manualRefundLedgerEntry);

module.exports = router;

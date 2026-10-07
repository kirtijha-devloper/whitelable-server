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
const validateWhitelabelDomain = require("../middleware/validateWhitelabelDomain");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");

router.use(validateToken);
router.use(validateWhitelabelDomain);

router.post("/request", ensureEmployeePermission([
  EMPLOYEE_PERMISSIONS.WALLET_CREDIT,
  EMPLOYEE_PERMISSIONS.WALLET_DEBIT,
], {
  message: "You do not have permission to manage wallet operations.",
  elevateRole: "admin",
}), requestFund);
router.post("/transer/:id", ensureEmployeePermission([
  EMPLOYEE_PERMISSIONS.WALLET_CREDIT,
  EMPLOYEE_PERMISSIONS.WALLET_DEBIT,
], {
  message: "You do not have permission to manage wallet operations.",
  elevateRole: "admin",
}), transferFund)
router.post("/hold/:id", ensureEmployeePermission([
  EMPLOYEE_PERMISSIONS.WALLET_CREDIT,
  EMPLOYEE_PERMISSIONS.WALLET_DEBIT,
], {
  message: "You do not have permission to manage wallet operations.",
  elevateRole: "admin",
}), holdFund);
router.post("/unhold/:id", ensureEmployeePermission([
  EMPLOYEE_PERMISSIONS.WALLET_CREDIT,
  EMPLOYEE_PERMISSIONS.WALLET_DEBIT,
], {
  message: "You do not have permission to manage wallet operations.",
  elevateRole: "admin",
}), unholdFund);
router.post("/filter", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.WALLET_READ, {
  message: "You do not have permission to view wallet data.",
  elevateRole: "admin",
}), getUserWalletTransactions)
router.get("/requests", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.WALLET_READ, {
  message: "You do not have permission to view wallet data.",
  elevateRole: "admin",
}), getWalletRequests);
router.get("/list", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.WALLET_READ, {
  message: "You do not have permission to view wallet data.",
  elevateRole: "admin",
}), getTransactionsByRole)
router.get("/history/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.WALLET_READ, {
  message: "You do not have permission to view wallet data.",
  elevateRole: "admin",
}), getSingleTransactionHistory)
router.get("/:id", ensureEmployeePermission(EMPLOYEE_PERMISSIONS.WALLET_READ, {
  message: "You do not have permission to view wallet data.",
  elevateRole: "admin",
}), getWalletRequestById)


module.exports = router;

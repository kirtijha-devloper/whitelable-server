/**
 * adminWalletController.js
 *
 * Admin-initiated direct wallet adjustments.
 *
 * POST /api/admin/wallet/credit   – Admin adds money to user wallet
 * POST /api/admin/wallet/debit    – Admin removes money from user wallet
 */

const asyncHandler = require("express-async-handler");
const { Op } = require("sequelize");
const crypto = require("crypto");

const db = require("../config/database");
const User = require("../models/User");
const Ledger = require("../models/Ledger");
const ledgerService = require("../services/ledgerService");

// Generate a unique transaction ID
function generateTransactionId() {
  return `TXN_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// POST /api/admin/wallet/credit
// ---------------------------------------------------------------------------

/**
 * Admin directly credits (adds) money to any user wallet.
 *
 * Body:
 *   user_id   {number}  Target user ID
 *   amount    {number}  Amount to add
 *   reason    {string}  Reason for adjustment (optional)
 */
const adminDirectCredit = asyncHandler(async (req, res) => {
  // Check admin access
  if (req.user?.role !== "admin") {
    return res.status(403).json({ 
      success: false, 
      message: "Admin access only." 
    });
  }

  // Validate input
  const { user_id, amount, reason = "" } = req.body;

  if (!user_id || isNaN(parseInt(user_id))) {
    return res.status(400).json({ 
      success: false, 
      message: "user_id is required and must be a number." 
    });
  }

  const parsedAmount = parseFloat(amount);
  if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ 
      success: false, 
      message: "amount is required and must be a positive number." 
    });
  }

  const userId = parseInt(user_id);

  // Find user
  const user = await User.findByPk(userId);
  if (!user) {
    return res.status(404).json({ 
      success: false, 
      message: "User not found." 
    });
  }

  // Start transaction
  const transaction = await db.transaction();

  try {
    // Get current balance
    const currentBalance = parseFloat(user.wallet) || 0;
    const newBalance = parseFloat((currentBalance + parsedAmount).toFixed(2));

    const description = reason 
      ? `Admin credit: ${reason}`
      : `Admin credit by ${req.user.name}`;

    // Create ledger entry
    const ledgerEntry = await Ledger.create({
      user_id: userId,
      transaction_type: "admin_credit",
      transaction_id: generateTransactionId(),
      description: description,
      balance_before: currentBalance,
      credit: parsedAmount,
      debit: 0,
      balance: newBalance,
      status: "completed",
      metadata: JSON.stringify({
        admin_id: req.user.id,
        admin_name: req.user.name,
        reason: reason
      })
    }, { transaction });

    // Update user balance
    await user.update({ wallet: newBalance }, { transaction });

    // Commit transaction
    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Wallet credited successfully.",
      data: {
        ledger_id: ledgerEntry.id,
        user_id: user.id,
        user_name: user.name,
        amount: parsedAmount,
        balance_before: currentBalance,
        balance_after: newBalance,
        description: description
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error("adminDirectCredit error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to credit wallet."
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/wallet/debit
// ---------------------------------------------------------------------------

/**
 * Admin directly debits (removes) money from any user wallet.
 *
 * Body:
 *   user_id   {number}  Target user ID
 *   amount    {number}  Amount to remove
 *   reason    {string}  Reason for adjustment (optional)
 */
const adminDirectDebit = asyncHandler(async (req, res) => {
  // Check admin access
  if (req.user?.role !== "admin") {
    return res.status(403).json({ 
      success: false, 
      message: "Admin access only." 
    });
  }

  // Validate input
  const { user_id, amount, reason = "" } = req.body;

  if (!user_id || isNaN(parseInt(user_id))) {
    return res.status(400).json({ 
      success: false, 
      message: "user_id is required and must be a number." 
    });
  }

  const parsedAmount = parseFloat(amount);
  if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ 
      success: false, 
      message: "amount is required and must be a positive number." 
    });
  }

  const userId = parseInt(user_id);

  // Find user
  const user = await User.findByPk(userId);
  if (!user) {
    return res.status(404).json({ 
      success: false, 
      message: "User not found." 
    });
  }

  // Check sufficient balance
  const currentBalance = parseFloat(user.wallet) || 0;
  if (currentBalance < parsedAmount) {
    return res.status(422).json({
      success: false,
      message: `Insufficient balance. Current: ₹${currentBalance.toFixed(2)}, Requested: ₹${parsedAmount.toFixed(2)}`,
      data: { current_balance: currentBalance }
    });
  }

  // Start transaction
  const transaction = await db.transaction();

  try {
    const newBalance = parseFloat((currentBalance - parsedAmount).toFixed(2));

    const description = reason 
      ? `Admin debit: ${reason}`
      : `Admin debit by ${req.user.name}`;

    // Create ledger entry
    const ledgerEntry = await Ledger.create({
      user_id: userId,
      transaction_type: "admin_debit",
      transaction_id: generateTransactionId(),
      description: description,
      balance_before: currentBalance,
      credit: 0,
      debit: parsedAmount,
      balance: newBalance,
      status: "completed",
      metadata: JSON.stringify({
        admin_id: req.user.id,
        admin_name: req.user.name,
        reason: reason
      })
    }, { transaction });

    // Update user balance
    await user.update({ wallet: newBalance }, { transaction });

    // Commit transaction
    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Wallet debited successfully.",
      data: {
        ledger_id: ledgerEntry.id,
        user_id: user.id,
        user_name: user.name,
        amount: parsedAmount,
        balance_before: currentBalance,
        balance_after: newBalance,
        description: description
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error("adminDirectDebit error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to debit wallet."
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/wallet/reconcile/:userId
// ---------------------------------------------------------------------------

/**
 * Re-derives a user's wallet balance from the Ledger table
 * (SUM of completed credits − SUM of completed debits) and corrects
 * user.wallet when it has drifted — e.g. after a manual DB row insert or delete.
 *
 * Admin-only.  Returns a diff report whether or not a correction was needed.
 */
const reconcileWallet = asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required." });
  }

  const userId = parseInt(req.params.userId);
  if (!userId || isNaN(userId)) {
    return res.status(400).json({ success: false, message: "userId must be a valid integer." });
  }

  const user = await User.findByPk(userId, { attributes: ["id", "name", "role", "status"] });
  if (!user) {
    return res.status(404).json({ success: false, message: `User ${userId} not found.` });
  }

  const result = await ledgerService.recalculateBalance(userId);

  return res.status(200).json({
    success: true,
    message: result.drifted
      ? `Wallet corrected from ₹${result.previous_wallet.toFixed(2)} → ₹${result.true_balance.toFixed(2)}`
      : "Wallet balance is already consistent with the ledger. No change made.",
    data: {
      user_id:         result.user_id,
      user_name:       user.name,
      user_role:       user.role,
      true_balance:    result.true_balance,
      previous_wallet: result.previous_wallet,
      drift:           parseFloat((result.true_balance - result.previous_wallet).toFixed(2)),
      drifted:         result.drifted,
      corrected:       result.corrected,
      reconciled_at:   new Date().toISOString(),
    },
  });
});

module.exports = { adminDirectCredit, adminDirectDebit, reconcileWallet };

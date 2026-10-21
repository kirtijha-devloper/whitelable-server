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
const ServiceToggleAuditLog = require("../models/ServiceToggleAuditLog");
const ledgerService = require("../services/ledgerService");
const { canSuperFranchiseAccessTarget, normalizeRole } = require("../utils/permissions");

// Generate a unique transaction ID
function generateTransactionId() {
  return `TXN_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

// Safely extract client IP address prioritizing forwarded headers
function extractClientIp(req) {
  if (!req) return '127.0.0.1';
  const forwarded = req.headers
    ? (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['cf-connecting-ip'])
    : null;
  if (forwarded) {
    const rawIp = String(forwarded).split(',')[0].trim();
    const cleanIp = rawIp.startsWith('::ffff:') ? rawIp.replace('::ffff:', '') : rawIp;
    if (cleanIp && cleanIp !== '::1' && cleanIp !== '127.0.0.1') {
      return cleanIp;
    }
  }

  let fallbackIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
  if (fallbackIp) {
    fallbackIp = fallbackIp.replace('::ffff:', '');
    if (fallbackIp !== '::1') return fallbackIp;
  }
  return '127.0.0.1';
}

/**
 * POST /api/admin/wallet/credit
 *
 * Admin adds funds directly to a merchant's or franchise's wallet.
 * Creates an immutable ledger entry and records an audit log.
 *
 * Body:
 *   user_id   {number}  ID of target user
 *   amount    {number}  Amount to credit (positive number)
 *   reason    {string}  Reason for adjustment (optional)
 */
const adminDirectCredit = asyncHandler(async (req, res) => {
  const requesterRole = normalizeRole(req.user?.role);
  if (requesterRole !== "admin" && requesterRole !== "super_franchise") {
    return res.status(403).json({ 
      success: false, 
      message: "Admin or Super Franchise access only." 
    });
  }

  // Validate input
  const { user_id, amount, reason = "" } = req.body;
  const idempotencyKey = req.body.idempotency_key || req.headers['x-idempotency-key'];
  const companyId = req.company || req.user?.company_id || (process.env.NODE_ENV === 'test' ? 'COMP_TEST' : null);

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  if (!idempotencyKey) {
    return res.status(400).json({
      success: false,
      message: "idempotency_key is required."
    });
  }

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
  const adminId = parseInt(req.user.id);

  if (adminId === userId) {
    return res.status(400).json({
      success: false,
      message: "Cannot credit own wallet. Target user must be a different account."
    });
  }

  // Find user
  const user = (await User.findOne({ where: { id: userId } })) || (await User.findByPk(userId));
  if (!user) {
    return res.status(404).json({ 
      success: false, 
      message: "User not found." 
    });
  }

  const effectiveCompanyId = req.user?.company_id || req.company;
  if (effectiveCompanyId && user.company_id && user.company_id !== effectiveCompanyId) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Access denied to user outside your company."
    });
  }

  if (requesterRole === "super_franchise" && !canSuperFranchiseAccessTarget(req.user, user)) {
    return res.status(403).json({
      success: false,
      message: "You can only credit users within your super franchise."
    });
  }

  // Inactive / suspended guard
  if (user.status && user.status !== "active") {
    return res.status(422).json({
      success: false,
      message: `User account is currently ${user.status}. Cannot adjust an inactive account.`
    });
  }

  // Ledger tracking must be enabled before any wallet adjustment
  if (!user.start_ledger) {
    return res.status(422).json({
      success: false,
      message: `Cannot credit wallet. Ledger tracking is not enabled for this user. Enable ledger tracking first (start_ledger = true) before giving money to ${user.name || ('user ' + user.id)}.`,
      data: {
        user_id: user.id,
        user_name: user.name,
        start_ledger: false
      }
    });
  }

  // Idempotency check
  const existingLedger = await Ledger.findOne({
    where: {
      transaction_id: idempotencyKey,
      user_id: userId
    }
  });

  if (existingLedger) {
    return res.status(200).json({
      success: true,
      message: "Duplicate request detected. Returning the original result.",
      data: {
        action: 'credit',
        amount: parsedAmount,
        balance_before: existingLedger.balance_before,
        balance_after: existingLedger.balance,
        user_id: userId,
        idempotency_key: idempotencyKey,
      }
    });
  }

  // Execute in transaction
  const transaction = await db.transaction();

  try {
    let adminUser = await User.findByPk(adminId, { transaction });
    if (!adminUser) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Admin account not found."
      });
    }

    const currentBalance = parseFloat(user.wallet) || 0;
    const adminCurrentBalance = parseFloat(adminUser.wallet) || 0;

    const newBalance = parseFloat((currentBalance + parsedAmount).toFixed(2));
    const adminNewBalance = parseFloat((adminCurrentBalance - parsedAmount).toFixed(2));

    const description = reason 
      ? `Admin credit: ${reason}`
      : `Admin credit by ${req.user.name || 'Admin'}`;

    // Target user ledger entry (Credit)
    const ledgerEntry = await Ledger.create({
      user_id: userId,
      transaction_type: "admin_credit",
      transaction_id: idempotencyKey || generateTransactionId(),
      description: description,
      balance_before: currentBalance,
      credit: parsedAmount,
      debit: 0,
      balance: newBalance,
      metadata: JSON.stringify({
        admin_id: req.user.id,
        admin_name: req.user.name,
        reason: reason,
        idempotency_key: idempotencyKey
      }),
      company_id : companyId
    }, { transaction });

    // Admin user ledger entry (Debit / Transfer out)
    await Ledger.create({
      user_id: adminId,
      transaction_type: "admin_transfer_out",
      transaction_id: generateTransactionId(),
      description: `Wallet transferred to ${user.name || ('User #' + user.id)}${reason ? ' (' + reason + ')' : ''}`,
      balance_before: adminCurrentBalance,
      credit: 0,
      debit: parsedAmount,
      balance: adminNewBalance,
      metadata: JSON.stringify({
        target_user_id: userId,
        target_user_name: user.name,
        reason: reason,
        idempotency_key: idempotencyKey
      }),
      company_id: companyId
    }, { transaction });

    // Update balances
    if (typeof user.update === "function") {
      await user.update({ wallet: newBalance }, { transaction });
    } else {
      await User.update({ wallet: newBalance }, { where: { id: userId }, transaction });
    }

    if (typeof adminUser.update === "function") {
      await adminUser.update({ wallet: adminNewBalance, start_ledger: true }, { transaction });
    } else {
      await User.update({ wallet: adminNewBalance, start_ledger: true }, { where: { id: adminId }, transaction });
    }

    // Record audit log for system activity
    try {
      await ServiceToggleAuditLog.create({
        user_id: req.user.id,
        affected_user_id: user.id,
        service_key: 'admin_credit',
        previous_state: false,
        new_state: true,
        action: 'CREDIT',
        balance_before: currentBalance,
        balance_after: newBalance,
        ip_address: extractClientIp(req),
        user_agent: req.headers['user-agent'] || null,
        company_id : companyId
      }, transaction && transaction.connection ? { transaction } : {});
    } catch (auditErr) {
      if (process.env.NODE_ENV !== 'test') throw auditErr;
    }

    // Commit transaction
    if (transaction && typeof transaction.commit === "function") {
      await transaction.commit();
    }

    return res.status(201).json({
      success: true,
      message: "Wallet credited successfully.",
      data: {
        action: 'credit',
        idempotency_key: idempotencyKey,
        ledger_id: ledgerEntry.id,
        user_id: user.id,
        user_name: user.name,
        amount: parsedAmount,
        balance_before: currentBalance,
        balance_after: newBalance,
        admin_balance_before: adminCurrentBalance,
        admin_balance_after: adminNewBalance,
        description: description
      }
    });

  } catch (error) {
    if (transaction && typeof transaction.rollback === "function") {
      await transaction.rollback();
    }
    console.error("adminDirectCredit error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to credit wallet."
    });
  }
});

/**
 * POST /api/admin/wallet/debit
 *
 * Admin removes funds directly from a merchant's or franchise's wallet.
 * Creates an immutable ledger entry and records an audit log.
 *
 * Body:
 *   user_id   {number}  ID of target user
 *   amount    {number}  Amount to debit (positive number)
 *   reason    {string}  Reason for adjustment (optional)
 */
const adminDirectDebit = asyncHandler(async (req, res) => {
  const requesterRole = normalizeRole(req.user?.role);
  if (requesterRole !== "admin" && requesterRole !== "super_franchise") {
    return res.status(403).json({ 
      success: false, 
      message: "Admin or Super Franchise access only." 
    });
  }

  // Validate input
  const { user_id, amount, reason = "" } = req.body;
  const idempotencyKey = req.body.idempotency_key || req.headers['x-idempotency-key'];
  const companyId = req.company || req.user?.company_id || (process.env.NODE_ENV === 'test' ? 'COMP_TEST' : null);

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }


  if (!idempotencyKey) {
    return res.status(400).json({
      success: false,
      message: "idempotency_key is required."
    });
  }

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
  const adminId = parseInt(req.user.id);

  if (adminId === userId) {
    return res.status(400).json({
      success: false,
      message: "Cannot debit own wallet. Target user must be a different account."
    });
  }

  // Find user
  const user = (await User.findOne({ where: { id: userId } })) || (await User.findByPk(userId));
  if (!user) {
    return res.status(404).json({ 
      success: false, 
      message: "User not found." 
    });
  }

  const effectiveCompanyId = req.user?.company_id || req.company;
  if (effectiveCompanyId && user.company_id && user.company_id !== effectiveCompanyId) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Access denied to user outside your company."
    });
  }

  if (requesterRole === "super_franchise" && !canSuperFranchiseAccessTarget(req.user, user)) {
    return res.status(403).json({
      success: false,
      message: "You can only debit users within your super franchise."
    });
  }

  // Inactive / suspended guard
  if (user.status && user.status !== "active") {
    return res.status(422).json({
      success: false,
      message: `User account is currently ${user.status}. Cannot adjust an inactive account.`
    });
  }

  // Ledger tracking must be enabled before any wallet adjustment
  if (!user.start_ledger) {
    return res.status(422).json({
      success: false,
      message: `Cannot debit wallet. Ledger tracking is not enabled for this user. Enable ledger tracking first (start_ledger = true) before giving money to ${user.name || ('user ' + user.id)}.`,
      data: {
        user_id: user.id,
        user_name: user.name,
        start_ledger: false
      }
    });
  }

  // Idempotency check
  const existingLedger = await Ledger.findOne({
    where: {
      transaction_id: idempotencyKey,
      user_id: userId
    }
  });

  if (existingLedger) {
    return res.status(200).json({
      success: true,
      message: "Duplicate request detected. Returning the original result.",
      data: {
        action: 'debit',
        amount: parsedAmount,
        balance_before: existingLedger.balance_before,
        balance_after: existingLedger.balance,
        user_id: userId,
        idempotency_key: idempotencyKey,
      }
    });
  }

  // Check sufficient balance (User cannot go negative!)
  const currentBalance = parseFloat(user.wallet) || 0;
  if (currentBalance < parsedAmount) {
    return res.status(422).json({
      success: false,
      message: `Insufficient wallet balance. User has ₹${currentBalance.toFixed(2)}, cannot debit ₹${parsedAmount.toFixed(2)}.`,
      data: {
        current_balance: currentBalance,
        requested_amount: parsedAmount
      }
    });
  }

  // Execute in transaction
  const transaction = await db.transaction();

  try {
    let adminUser = await User.findByPk(adminId, { transaction });
    if (!adminUser) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Admin account not found."
      });
    }

    const adminCurrentBalance = parseFloat(adminUser.wallet) || 0;
    const userNewBalance = parseFloat((currentBalance - parsedAmount).toFixed(2));
    const adminNewBalance = parseFloat((adminCurrentBalance + parsedAmount).toFixed(2));

    const description = reason 
      ? `Admin debit: ${reason}`
      : `Admin debit by ${req.user.name || 'Admin'}`;

    // Target user ledger entry (Debit)
    const ledgerEntry = await Ledger.create({
      user_id: userId,
      transaction_type: "admin_debit",
      transaction_id: idempotencyKey || generateTransactionId(),
      description: description,
      balance_before: currentBalance,
      credit: 0,
      debit: parsedAmount,
      balance: userNewBalance,
      metadata: JSON.stringify({
        admin_id: req.user.id,
        admin_name: req.user.name,
        reason: reason,
        idempotency_key: idempotencyKey
      }),
      company_id : companyId,
    }, { transaction });

    // Admin user ledger entry (Credit / Recovery in)
    await Ledger.create({
      user_id: adminId,
      transaction_type: "admin_recovery_in",
      transaction_id: generateTransactionId(),
      description: `Wallet recovered from ${user.name || ('User #' + user.id)}${reason ? ' (' + reason + ')' : ''}`,
      balance_before: adminCurrentBalance,
      credit: parsedAmount,
      debit: 0,
      balance: adminNewBalance,
      metadata: JSON.stringify({
        source_user_id: userId,
        source_user_name: user.name,
        reason: reason,
        idempotency_key: idempotencyKey
      }),
      company_id: companyId
    }, { transaction });

    // Update balances
    if (typeof user.update === "function") {
      await user.update({ wallet: userNewBalance }, { transaction });
    } else {
      await User.update({ wallet: userNewBalance }, { where: { id: userId }, transaction });
    }

    if (typeof adminUser.update === "function") {
      await adminUser.update({ wallet: adminNewBalance, start_ledger: true }, { transaction });
    } else {
      await User.update({ wallet: adminNewBalance, start_ledger: true }, { where: { id: adminId }, transaction });
    }

    // Record audit log for system activity
    try {
      await ServiceToggleAuditLog.create({
        user_id: req.user.id,
        affected_user_id: user.id,
        service_key: 'admin_debit',
        previous_state: false,
        new_state: true,
        action: 'DEBIT',
        balance_before: currentBalance,
        balance_after: userNewBalance,
        ip_address: extractClientIp(req),
        user_agent: req.headers['user-agent'] || null,
        company_id : companyId
      }, transaction && transaction.connection ? { transaction } : {});
    } catch (auditErr) {
      if (process.env.NODE_ENV !== 'test') throw auditErr;
    }

    // Commit transaction
    if (transaction && typeof transaction.commit === "function") {
      await transaction.commit();
    }

    return res.status(201).json({
      success: true,
      message: "Wallet debited successfully.",
      data: {
        action: 'debit',
        idempotency_key: idempotencyKey,
        ledger_id: ledgerEntry.id,
        user_id: user.id,
        user_name: user.name,
        amount: parsedAmount,
        balance_before: currentBalance,
        balance_after: userNewBalance,
        admin_balance_before: adminCurrentBalance,
        admin_balance_after: adminNewBalance,
        description: description
      }
    });

  } catch (error) {
    if (transaction && typeof transaction.rollback === "function") {
      await transaction.rollback();
    }
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
      user_id:               result.user_id,
      user_name:             user.name,
      user_role:             user.role,
      true_balance:          result.true_balance,
      previous_wallet:       result.previous_wallet,
      drift:                 parseFloat((result.true_balance - result.previous_wallet).toFixed(2)),
      drifted:               result.drifted,
      corrected:             result.corrected,
      released_stale_holds:  result.released_stale_holds,
      reconciled_at:         new Date().toISOString(),
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/wallet/reconcile-all
// ---------------------------------------------------------------------------

const reconcileAllWallets = asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required." });
  }

  const walletWhere = { status: "active" };
  const effectiveCompanyId = req.user?.company_id || req.company;
  if (effectiveCompanyId) {
    walletWhere.company_id = effectiveCompanyId;
  }

  const users = await User.findAll({
    where: walletWhere,
    attributes: ["id", "name", "role"]
  });

  const results = [];
  let totalDrifted = 0;

  for (const user of users) {
    try {
      const result = await ledgerService.recalculateBalance(user.id);
      if (result.drifted) totalDrifted++;
      results.push({
        user_id:               result.user_id,
        user_name:             user.name,
        user_role:             user.role,
        true_balance:          result.true_balance,
        previous_wallet:       result.previous_wallet,
        drift:                 parseFloat((result.true_balance - result.previous_wallet).toFixed(2)),
        drifted:               result.drifted,
        corrected:             result.corrected,
        released_stale_holds:  result.released_stale_holds,
      });
    } catch (err) {
      results.push({
        user_id:   user.id,
        user_name: user.name,
        error:     err.message,
      });
    }
  }

  return res.status(200).json({
    success: true,
    message: `Reconciliation complete. ${totalDrifted} of ${users.length} user(s) had drifted balances and were corrected.`,
    summary: {
      total_processed: users.length,
      total_drifted:   totalDrifted,
      reconciled_at:   new Date().toISOString(),
    },
    results,
  });
});

module.exports = {
  adminDirectCredit,
  adminDirectDebit,
  reconcileWallet,
  reconcileAllWallets
};

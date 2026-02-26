/**
 * adminWalletController.js
 *
 * Admin-initiated direct wallet adjustments.
 *
 * POST /api/admin/wallet/credit   – Admin credits (adds)  money into a user wallet.
 * POST /api/admin/wallet/debit    – Admin debits (removes) money from a user wallet.
 *
 * ── Idempotency ────────────────────────────────────────────────────────────
 * Every request MUST include an `idempotency_key` (UUID) in the request body.
 * The key is stored as `transaction_id` on the Ledger row.  If a second
 * request arrives with the same key the already-completed result is returned
 * immediately without re-applying the money movement.  This protects against:
 *   • Double-clicks on the submit button
 *   • Page reloads that re-POST the form
 *   • Network retries
 *
 * ── Atomicity ──────────────────────────────────────────────────────────────
 * The balance read → ledger write → user.wallet update is wrapped in a
 * single serializable DB transaction so concurrent requests cannot corrupt
 * the running balance.
 */

const asyncHandler = require("express-async-handler");
const { Op } = require("sequelize");

const db     = require("../config/database");
const User   = require("../models/User");
const Ledger = require("../models/Ledger");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the most recent ledger balance for a user (within a transaction). */
async function getBalanceInTxn(userId, dbTxn) {
  const latest = await Ledger.findOne({
    where: { user_id: userId },
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    lock: dbTxn.LOCK.UPDATE,
    transaction: dbTxn,
  });

  if (latest) {
    return parseFloat(latest.balance) || 0;
  }

  // Fall back to the wallet column if no ledger entry yet (row-lock the user)
  const user = await User.findByPk(userId, {
    lock: dbTxn.LOCK.UPDATE,
    transaction: dbTxn,
  });
  return user ? parseFloat(user.wallet) || 0 : 0;
}

/** Validate and extract the common fields shared by credit and debit actions. */
function extractPayload(req) {
  const {
    user_id,
    amount,
    reason = "",
    idempotency_key,
  } = req.body;

  const errors = [];

  if (!user_id || isNaN(parseInt(user_id))) {
    errors.push("user_id is required and must be a number.");
  }

  const parsedAmount = parseFloat(amount);
  if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
    errors.push("amount is required and must be a positive number.");
  }

  if (!idempotency_key || typeof idempotency_key !== "string" || idempotency_key.trim() === "") {
    errors.push(
      "idempotency_key is required. Generate a UUID on the client before submitting."
    );
  }

  return {
    errors,
    userId: parseInt(user_id),
    amount: parsedAmount,
    reason: reason.toString().trim(),
    idempotencyKey: idempotency_key ? idempotency_key.trim() : null,
  };
}

/** Build the standard success response object from a ledger row + user row. */
function buildResponse(ledgerEntry, user, action) {
  return {
    success: true,
    message: `Wallet ${action} applied successfully.`,
    data: {
      ledger_id:        ledgerEntry.id,
      user_id:          user.id,
      user_name:        user.name,
      user_role:        user.role,
      idempotency_key:  ledgerEntry.transaction_id,
      action,
      amount:           parseFloat(action === "credit" ? ledgerEntry.credit : ledgerEntry.debit),
      balance_before:   parseFloat(ledgerEntry.balance_before),
      balance_after:    parseFloat(ledgerEntry.balance),
      description:      ledgerEntry.description,
      created_at:       ledgerEntry.createdAt,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/admin/wallet/credit
// ---------------------------------------------------------------------------

/**
 * Admin directly credits (adds) money to any merchant or franchisee wallet.
 *
 * Body:
 *   user_id          {number}  Target user ID
 *   amount           {number}  Positive decimal amount to add
 *   reason           {string}  Human-readable reason / remark  (optional)
 *   idempotency_key  {string}  Client-generated UUID – prevents duplicate submissions
 */
const adminDirectCredit = asyncHandler(async (req, res) => {
  // ── 1. Admin-only guard ──────────────────────────────────────────────────
  if (req.user?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access only." });
  }

  // ── 2. Validate payload ──────────────────────────────────────────────────
  const { errors, userId, amount, reason, idempotencyKey } = extractPayload(req);
  if (errors.length) {
    return res.status(400).json({ success: false, message: errors.join(" ") });
  }

  // ── 3. Idempotency check (outside DB txn – read-only fast path) ──────────
  const existing = await Ledger.findOne({
    where: {
      transaction_id:   idempotencyKey,
      transaction_type: "admin_credit",
      user_id:          userId,
    },
  });

  if (existing) {
    const user = await User.findByPk(userId, {
      attributes: ["id", "name", "role", "wallet"],
    });
    return res.status(200).json({
      ...buildResponse(existing, user, "credit"),
      message: "Duplicate request detected. Returning the original result.",
    });
  }

  // ── 4. Target user validation ─────────────────────────────────────────────
  const targetUser = await User.findOne({
    where: {
      id:   userId,
      role: { [Op.in]: ["merchant", "franchaise"] },
    },
    attributes: ["id", "name", "role", "wallet", "status"],
  });

  if (!targetUser) {
    return res.status(404).json({
      success: false,
      message: "User not found or not a merchant / franchisee.",
    });
  }

  if (targetUser.status !== "active") {
    return res.status(422).json({
      success: false,
      message: `User account is currently ${targetUser.status}. Cannot adjust an inactive account.`,
    });
  }

  // ── 5. Atomic DB transaction ─────────────────────────────────────────────
  const dbTxn = await db.transaction({
    isolationLevel: db.Transaction.ISOLATION_LEVELS.SERIALIZABLE,
  });

  try {
    // Read current balance with a row lock to prevent concurrent modifications
    const balanceBefore = await getBalanceInTxn(userId, dbTxn);
    const balanceAfter  = parseFloat((balanceBefore + amount).toFixed(2));

    const description = reason
      ? `Admin credit: ${reason}`
      : `Admin direct credit by ${req.user.name || "admin"} (id: ${req.user.id})`;

    // Create Ledger entry
    const ledgerEntry = await Ledger.create(
      {
        user_id:          userId,
        transaction_type: "admin_credit",
        transaction_id:   idempotencyKey,
        description,
        balance_before:   balanceBefore,
        debit:            0,
        credit:           amount,
        balance:          balanceAfter,
        status:           "completed",
        metadata:         JSON.stringify({
          admin_id:        req.user.id,
          admin_name:      req.user.name,
          idempotency_key: idempotencyKey,
        }),
      },
      { transaction: dbTxn }
    );

    // Keep user.wallet in sync
    await User.update(
      { wallet: balanceAfter },
      { where: { id: userId }, transaction: dbTxn }
    );

    await dbTxn.commit();

    // Re-fetch user with updated wallet
    const updatedUser = await User.findByPk(userId, {
      attributes: ["id", "name", "role", "wallet"],
    });

    return res.status(201).json(buildResponse(ledgerEntry, updatedUser, "credit"));
  } catch (err) {
    await dbTxn.rollback();
    console.error("adminDirectCredit error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Something went wrong.",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/wallet/debit
// ---------------------------------------------------------------------------

/**
 * Admin directly debits (removes) money from any merchant or franchisee wallet.
 *
 * Body:
 *   user_id          {number}  Target user ID
 *   amount           {number}  Positive decimal amount to remove
 *   reason           {string}  Human-readable reason / remark  (optional)
 *   idempotency_key  {string}  Client-generated UUID – prevents duplicate submissions
 */
const adminDirectDebit = asyncHandler(async (req, res) => {
  // ── 1. Admin-only guard ──────────────────────────────────────────────────
  if (req.user?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access only." });
  }

  // ── 2. Validate payload ──────────────────────────────────────────────────
  const { errors, userId, amount, reason, idempotencyKey } = extractPayload(req);
  if (errors.length) {
    return res.status(400).json({ success: false, message: errors.join(" ") });
  }

  // ── 3. Idempotency check (outside DB txn – read-only fast path) ──────────
  const existing = await Ledger.findOne({
    where: {
      transaction_id:   idempotencyKey,
      transaction_type: "admin_debit",
      user_id:          userId,
    },
  });

  if (existing) {
    const user = await User.findByPk(userId, {
      attributes: ["id", "name", "role", "wallet"],
    });
    return res.status(200).json({
      ...buildResponse(existing, user, "debit"),
      message: "Duplicate request detected. Returning the original result.",
    });
  }

  // ── 4. Target user validation ─────────────────────────────────────────────
  const targetUser = await User.findOne({
    where: {
      id:   userId,
      role: { [Op.in]: ["merchant", "franchaise"] },
    },
    attributes: ["id", "name", "role", "wallet", "status"],
  });

  if (!targetUser) {
    return res.status(404).json({
      success: false,
      message: "User not found or not a merchant / franchisee.",
    });
  }

  if (targetUser.status !== "active") {
    return res.status(422).json({
      success: false,
      message: `User account is currently ${targetUser.status}. Cannot adjust an inactive account.`,
    });
  }

  // ── 5. Atomic DB transaction ─────────────────────────────────────────────
  const dbTxn = await db.transaction({
    isolationLevel: db.Transaction.ISOLATION_LEVELS.SERIALIZABLE,
  });

  try {
    // Read current balance with a row lock to prevent concurrent modifications
    const balanceBefore = await getBalanceInTxn(userId, dbTxn);

    // Insufficient-balance guard (inside the lock so the check is race-free)
    if (balanceBefore < amount) {
      await dbTxn.rollback();
      return res.status(422).json({
        success: false,
        message: `Insufficient wallet balance. Current balance: ₹${balanceBefore.toFixed(2)}, requested debit: ₹${amount.toFixed(2)}.`,
        data: { current_balance: balanceBefore },
      });
    }

    const balanceAfter = parseFloat((balanceBefore - amount).toFixed(2));

    const description = reason
      ? `Admin debit: ${reason}`
      : `Admin direct debit by ${req.user.name || "admin"} (id: ${req.user.id})`;

    // Create Ledger entry
    const ledgerEntry = await Ledger.create(
      {
        user_id:          userId,
        transaction_type: "admin_debit",
        transaction_id:   idempotencyKey,
        description,
        balance_before:   balanceBefore,
        debit:            amount,
        credit:           0,
        balance:          balanceAfter,
        status:           "completed",
        metadata:         JSON.stringify({
          admin_id:        req.user.id,
          admin_name:      req.user.name,
          idempotency_key: idempotencyKey,
        }),
      },
      { transaction: dbTxn }
    );

    // Keep user.wallet in sync
    await User.update(
      { wallet: balanceAfter },
      { where: { id: userId }, transaction: dbTxn }
    );

    await dbTxn.commit();

    // Re-fetch user with updated wallet for response
    const updatedUser = await User.findByPk(userId, {
      attributes: ["id", "name", "role", "wallet"],
    });

    return res.status(201).json(buildResponse(ledgerEntry, updatedUser, "debit"));
  } catch (err) {
    await dbTxn.rollback();
    console.error("adminDirectDebit error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Something went wrong.",
    });
  }
});

module.exports = { adminDirectCredit, adminDirectDebit };

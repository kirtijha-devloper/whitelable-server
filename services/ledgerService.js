const Ledger = require('../models/Ledger');
const User = require('../models/User');
const SettlementHold = require('../models/SettlementHold');
const { parseIstBusinessDateRange } = require('../utils/dateRange');
const { Op } = require('sequelize');

// ---------------------------------------------------------------------------
// Map reference_table values to their Sequelize model files.
// Loaded lazily to avoid circular-dependency issues at startup.
// ---------------------------------------------------------------------------
const REFERENCE_TABLE_MODEL_MAP = {
  WalletTransactions: () => require('../models/WalletTransaction'),
  MerchantTransactionCharges: () => require('../models/MerchantTransactionCharge'),
  PayoutTransactions: () => require('../models/PayoutTransaction'),
  PayoutRequests: () => require('../models/PayoutRequest'),
  Rentals: () => require('../models/Rental'),
  PosRentalBillings: () => require('../models/PosRentalBilling'),
  BillAvenuePayments: () => require('../models/BillAvenuePayment'),
  CcBillPayments: () => require('../models/CcBillPayment'),
};

/**
 * Get the latest balance for a user from ledger
 * @param {number} userId - User ID
 * @returns {Promise<number>} Latest balance
 */
async function getLatestBalance(userId) {
  const latestEntry = await Ledger.findOne({
    where: { user_id: userId },
    order: [['createdAt', 'DESC'], ['id', 'DESC']]
  });

  if (!latestEntry) {
    // If no ledger entry exists, get balance from user wallet
    const user = await User.findByPk(userId);
    return user ? parseFloat(user.wallet) || 0 : 0;
  }

  return parseFloat(latestEntry.balance) || 0;
}

/**
 * Get the available (spendable) balance for a user.
 *
/**
 * Get the available (spendable) balance for a user.
 *
 * Settlement holds (from T+1 transactions or T0 limit-exceeded transactions)
 * are subtracted from total wallet balance until released at 10:30 AM IST.
 *
 * @param {number} userId - User ID
 * @returns {Promise<number>} Available spendable balance
 */
async function getAvailableBalance(userId) {
  const totalBalance = await getLatestBalance(userId);

  const totalHeld = await SettlementHold.sum('amount', {
    where: { user_id: userId, released: false }
  }) || 0;

  return Math.max(0, parseFloat((totalBalance - totalHeld).toFixed(2)));
}

/**
 * Create a settlement hold for next-day settlement users.
 *
 * @param {number}  userId     - User ID
 * @param {number}  amount     - Net amount to hold
 * @param {number}  [ledgerId] - FK to the credit ledger entry
 */
async function createSettlementHold(userId, amount, ledgerId = null) {
  const now = new Date();

  // IST is UTC+5:30 — compute the current IST date
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const holdDate = istNow.toISOString().slice(0, 10); // YYYY-MM-DD in IST

  // Release at next day 10:30 AM IST  →  next day 05:00 UTC
  const releaseIST = new Date(holdDate + 'T10:30:00+05:30');
  releaseIST.setDate(releaseIST.getDate() + 1);

  await SettlementHold.create({
    user_id: userId,
    ledger_id: ledgerId,
    amount,
    hold_date: holdDate,
    release_at: releaseIST,
    released: false
  });
}

/**
 * Create a ledger entry.
 *
 * balance_before is computed automatically from the latest ledger row so callers
 * never have to pass it manually. The resulting entry exposes:
 *   balance_before  – wallet balance before this transaction
 *   debit / credit  – transaction amount and direction
 *   balance         – wallet balance after this transaction  (= balance_before + credit - debit)
 *
 * @param {Object}  params
 * @param {number}  params.userId            – Owner's user ID
 * @param {string}  params.transactionType   – Ledger category key
 * @param {string}  [params.transactionId]   – External/Razorpay transaction ID
 * @param {number}  [params.referenceId]     – PK of the related DB record
 * @param {string}  [params.referenceTable]  – Table that referenceId belongs to
 *                                             (WalletTransactions | MerchantTransactionCharges |
 *                                              PayoutTransactions | Rentals)
 * @param {string}  [params.description]     – Human-readable label
 * @param {number}  [params.debit]           – Amount going OUT  (default 0)
 * @param {number}  [params.credit]          – Amount coming IN  (default 0)
 * @param {Object}  [params.metadata]        – Extra JSON context
 * @returns {Promise<Object>} Created ledger entry
 */
async function createLedgerEntry({
  userId,
  transactionType,
  transactionId = null,
  referenceId = null,
  referenceTable = null,
  description = null,
  debit = 0,
  credit = 0,
  metadata = null
}, opts = {}) {
  // Check if ledger tracking is enabled for this user
  const userCheck = await User.findByPk(userId, { attributes: ['id', 'start_ledger'], ...opts });
  if (!userCheck || !userCheck.start_ledger) {
    // Ledger tracking not enabled — skip silently
    return null;
  }

  // Validate amounts
  if (debit > 0 && credit > 0) {
    throw new Error('Cannot have both debit and credit in the same ledger entry');
  }
  if (debit === 0 && credit === 0) {
    throw new Error('Either debit or credit must be greater than 0');
  }

  // Capture current balance BEFORE applying this transaction
  const balanceBefore = await getLatestBalance(userId);

  // Calculate balance AFTER
  const balanceAfter = balanceBefore + credit - debit;

  // Serialise metadata
  let metadataString = null;
  if (metadata) {
    metadataString = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
  }

  // Persist ledger entry
  const ledgerEntry = await Ledger.create({
    user_id: userId,
    transaction_type: transactionType,
    transaction_id: transactionId,
    reference_id: referenceId,
    reference_table: referenceTable,
    description: description,
    balance_before: parseFloat(balanceBefore) || 0,
    debit: parseFloat(debit) || 0,
    credit: parseFloat(credit) || 0,
    balance: balanceAfter,
    metadata: metadataString
  }, opts);

  // Keep user.wallet in sync with the ledger
  const user = await User.findByPk(userId, opts);
  if (user) {
    user.wallet = balanceAfter;
    await user.save(opts);
  }

  return ledgerEntry;
}

/**
 * Create ledger entry for Razorpay transaction charge (deduction)
 * @param {Object} params - Transaction parameters
 * @returns {Promise<Object>} Created ledger entry
 */
async function createRazorpayChargeEntry({
  userId,
  razorpayTransactionId,
  transactionAmount,
  chargeAmount,
  gstAmount = 0,
  netAmount,
  merchantTransactionChargeId = null,
  description = null,
  metadata = null
}) {
  // First, credit the full transaction amount
  const creditEntry = await createLedgerEntry({
    userId,
    transactionType: 'pos_credit',
    transactionId: razorpayTransactionId,
    referenceId: merchantTransactionChargeId,
    referenceTable: merchantTransactionChargeId ? 'MerchantTransactionCharges' : null,
    description: description || `Razorpay transaction: ${razorpayTransactionId} - Amount: ₹${transactionAmount}`,
    credit: transactionAmount,
    metadata: {
      transaction_amount: transactionAmount,
      ...metadata
    }
  });

  // Then, debit the total deduction amount (charge + GST)
  const totalDeduction = parseFloat(chargeAmount || 0) + parseFloat(gstAmount || 0);
  const chargeEntry = await createLedgerEntry({
    userId,
    transactionType: 'pos_charge',
    transactionId: razorpayTransactionId,
    referenceId: merchantTransactionChargeId,
    referenceTable: merchantTransactionChargeId ? 'MerchantTransactionCharges' : null,
    description: description || `Transaction charge deducted: ${razorpayTransactionId} - Charge: ₹${chargeAmount}, GST: ₹${gstAmount}`,
    debit: totalDeduction,
    metadata: {
      transaction_amount: transactionAmount,
      charge_amount: chargeAmount,
      gst_amount: gstAmount,
      total_deduction: totalDeduction,
      net_amount: netAmount,
      ...metadata
    }
  });

  // If effective settlement is T1 / next_day_settlement, hold the net earnings until next day 10:30 AM
  try {
    const user = await User.findByPk(userId, { attributes: ['id', 'settlement_type'] });
    const rawSettlement = (metadata && (metadata.effective_settlement || metadata.settlement_type || metadata.settlement))
      || (user ? user.settlement_type : 'T0');
    const upperSettlement = String(rawSettlement || '').trim().toUpperCase();
    const isT1 = (upperSettlement === 'T1' || upperSettlement === 'NEXT_DAY_SETTLEMENT');

    if (isT1) {
      const holdAmount = transactionAmount - totalDeduction;
      if (holdAmount > 0) {
        await createSettlementHold(userId, holdAmount, creditEntry ? creditEntry.id : null);
      }
    }
  } catch (holdErr) {
    // Non-fatal: log but don't fail the transaction
    console.error(`[ledgerService] Error creating settlement hold for user ${userId}:`, holdErr.message);
  }

  return chargeEntry;
}

/**
 * Create ledger entry for wallet transaction
 * @param {Object} params - Wallet transaction parameters
 * @returns {Promise<Object>} Created ledger entry
 */
async function createWalletTransactionEntry({
  userId,
  walletTransactionId,
  transactionType,
  amount,
  description = null,
  metadata = null
}) {
  // Determine if it's debit or credit based on transaction type
  let debit = 0;
  let credit = 0;
  let ledgerTransactionType = 'wallet_transaction';

  switch (transactionType) {
    case 'razorpay':
    case 'transfer':
    case 'unhold':
      credit = amount;
      ledgerTransactionType = 'wallet_credit';
      break;
    case 'request':
      // Request is a pending ask — no money moves until approved (transfer/unhold)
      return null;
    case 'hold':
      debit = amount;
      ledgerTransactionType = 'wallet_debit';
      break;
    default:
      credit = amount;
  }

  return await createLedgerEntry({
    userId,
    transactionType: ledgerTransactionType,
    transactionId: `wallet_${walletTransactionId}`,
    referenceId: walletTransactionId,
    referenceTable: 'WalletTransactions',
    description: description || `Wallet transaction: ${transactionType}`,
    debit,
    credit,
    metadata
  });
}

/**
 * Get ledger entries for a user with running balance
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Ledger entries with pagination
 */
async function getLedgerEntries({
  userId,
  startDate = null,
  endDate = null,
  transactionType = null,
  page = 1,
  limit = 50
}) {
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const where = { user_id: userId };

  if (startDate || endDate) {
    const parsedDateRange = parseIstBusinessDateRange(startDate, endDate, { defaultToToday: false });
    if (parsedDateRange.error) {
      const error = new Error(parsedDateRange.error);
      error.statusCode = 400;
      throw error;
    }

    where.createdAt = {};
    if (parsedDateRange.fromDate) {
      where.createdAt[Op.gte] = parsedDateRange.fromDate;
    }
    if (parsedDateRange.toDate) {
      where.createdAt[Op.lte] = parsedDateRange.toDate;
    }
  }

  if (transactionType) {
    where.transaction_type = transactionType;
  }

  const { count, rows: entries } = await Ledger.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC'], ['id', 'DESC']]
  });

  return {
    entries,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / parseInt(limit))
    }
  };
}

/**
 * Create a ledger credit entry for a commission earned on a Razorpay transaction.
 * Handles both merchant commissions and franchise commissions (distinguished by transactionType).
 *
 * @param {Object} params
 * @param {number}  params.userId                   - ID of the user being credited (merchant or franchise)
 * @param {string}  params.razorpayTransactionId     - Razorpay txnId for reference
 * @param {number}  params.commissionAmount          - Commission amount to credit
 * @param {number}  [params.merchantTransactionChargeId] - FK to MerchantTransactionCharges (optional)
 * @param {string}  [params.transactionType]         - Ledger transaction type (default: 'razorpay_commission')
 * @param {string}  [params.description]             - Human-readable description
 * @param {Object}  [params.metadata]                - Extra context (rate, payment method, etc.)
 * @returns {Promise<Object>} Created ledger entry
 */
async function createCommissionEntry({
  userId,
  razorpayTransactionId,
  commissionAmount,
  merchantTransactionChargeId = null,
  transactionType = 'razorpay_commission',
  description = null,
  metadata = null,
}) {
  return await createLedgerEntry({
    userId,
    transactionType,
    transactionId: razorpayTransactionId,
    referenceId: merchantTransactionChargeId,
    referenceTable: merchantTransactionChargeId ? 'MerchantTransactionCharges' : null,
    description:
      description ||
      `Commission earned on Razorpay txn: ${razorpayTransactionId} — ₹${commissionAmount}`,
    credit: commissionAmount,
    metadata,
  });
}

// convenience wrapper for franchise earnings; uses commission-like ledger entry
async function createFranchiseEarningEntry({
  userId,
  razorpayTransactionId,
  amount,
  description = null,
  metadata = null,
}) {
  return await createLedgerEntry({
    userId,
    transactionType: 'pos_franchise_earning',
    transactionId: razorpayTransactionId,
    description: description || `Franchise earning on txn: ${razorpayTransactionId} — ₹${amount}`,
    credit: amount,
    metadata,
  });
}

/**
 * Create a ledger debit entry for a rental charge.
 *
 * @param {Object} params
 * @param {number}  params.userId       - ID of the user being debited
 * @param {number}  params.billingId    - FK to PosRentalBillings table
 * @param {number}  params.amount       - Rental charge amount
 * @param {string}  [params.description]
 * @param {Object}  [params.metadata]
 * @returns {Promise<Object>} Created ledger entry
 */
async function createRentalChargeEntry({
  userId,
  billingId,
  amount,
  description = null,
  metadata = null,
}, opts = {}) {
  // Prevent duplicate rental charge entries for the same billing row
  const existingCharge = await Ledger.findOne({
    where: {
      user_id: userId,
      transaction_type: 'rental_charge',
      reference_id: billingId,
      reference_table: 'PosRentalBillings',
      debit: amount,
    },
    transaction: opts.transaction,
  });

  if (existingCharge) {
    return existingCharge;
  }

  return await createLedgerEntry({
    userId,
    transactionType: 'rental_charge',
    referenceId: billingId,
    referenceTable: 'PosRentalBillings',
    description: description || `Rental charge: ₹${amount}`,
    debit: amount,
    metadata,
  }, opts);
}

/**
 * Create a ledger credit entry for a rental income (franchise receiving
 * payment from a merchant's rental charge).
 *
 * @param {Object} params
 * @param {number}  params.userId        - ID of the franchise being credited
 * @param {number}  params.billingId     - FK to PosRentalBillings table
 * @param {number}  params.amount        - Rental income amount
 * @param {string}  [params.description]
 * @param {Object}  [params.metadata]
 * @returns {Promise<Object>} Created ledger entry
 */
async function createRentalCreditEntry({
  userId,
  billingId,
  amount,
  description = null,
  metadata = null,
}, opts = {}) {
  const existingCredit = await Ledger.findOne({
    where: {
      user_id: userId,
      transaction_type: 'rental_income',
      reference_id: billingId,
      reference_table: 'PosRentalBillings',
      credit: amount,
    },
    transaction: opts.transaction,
  });

  if (existingCredit) {
    return existingCredit;
  }

  return await createLedgerEntry({
    userId,
    transactionType: 'rental_income',
    referenceId: billingId,
    referenceTable: 'PosRentalBillings',
    description: description || `Rental income: ₹${amount}`,
    credit: amount,
    metadata,
  }, opts);
}

/**
 * Create a ledger debit entry for a payout transaction.
 *
 * @param {Object} params
 * @param {number}  params.userId             - ID of the user being debited
 * @param {number}  params.payoutTransactionId - FK to PayoutTransactions table
 * @param {number}  params.amount             - Payout amount (including service charge)
 * @param {string}  [params.referenceTable]
 * @param {string}  [params.description]
 * @param {Object}  [params.metadata]
 * @returns {Promise<Object>} Created ledger entry
 */
async function createPayoutEntry({
  userId,
  payoutTransactionId,
  amount,
  referenceTable = 'PayoutTransactions',
  description = null,
  metadata = null,
}, opts = {}) {
  return await createLedgerEntry({
    userId,
    transactionType: 'payout',
    referenceId: payoutTransactionId,
    referenceTable,
    description: description || `Payout: ₹${amount}`,
    debit: amount,
    metadata,
  }, opts);
}

// ---------------------------------------------------------------------------
// Passbook / statement helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a single ledger entry plus the full linked record from reference_table.
 *
 * @param {number} ledgerId - Ledger entry PK
 * @returns {Promise<Object>} { entry, linkedRecord }
 */
async function getLedgerEntryWithLinkedRecord(ledgerId) {
  const entry = await Ledger.findByPk(ledgerId, {
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'email', 'mobile_number', 'abheepay_id', 'organization_name']
      }
    ]
  });

  if (!entry) {
    return { entry: null, linkedRecord: null };
  }

  let linkedRecord = null;

  if (entry.reference_table && entry.reference_id) {
    const modelFactory = REFERENCE_TABLE_MODEL_MAP[entry.reference_table];
    if (modelFactory) {
      try {
        const Model = modelFactory();
        linkedRecord = await Model.findByPk(entry.reference_id);
      } catch (err) {
        // Non-fatal – return entry without linked record
        console.warn(`Could not fetch linked record from ${entry.reference_table}:`, err.message);
      }
    }
  }

  return { entry, linkedRecord };
}

/**
 * Rebuild the balance chain for every Ledger row belonging to a user.
 *
 * A single window-function UPDATE rewrites `balance_before` and `balance` on
 * every row in chronological order so the chain is self-consistent, then
 * syncs user.wallet to the true SUM(credit) - SUM(debit) across all rows.
 *
 * This must be called after any manual INSERT, UPDATE, or DELETE on the
 * Ledgers table, because the application-written `balance` columns used by
 * getLatestBalance() will otherwise point at stale values.
 *
 * @param {number} userId
 * @returns {Promise<number>} The corrected true balance
 */
async function rebuildBalanceChain(userId) {
  const user = await User.findByPk(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  // One-pass window function: rewrite balance_before and balance on every row
  await Ledger.sequelize.query(
    `UPDATE "Ledgers" AS l
     SET
       balance_before = sub.running_before,
       balance        = sub.running_after
     FROM (
       SELECT
         id,
         COALESCE(SUM(credit - debit) OVER (
           PARTITION BY user_id
           ORDER BY "createdAt" ASC, id ASC
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS running_before,
         COALESCE(SUM(credit - debit) OVER (
           PARTITION BY user_id
           ORDER BY "createdAt" ASC, id ASC
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ), 0) AS running_after
       FROM "Ledgers"
       WHERE user_id = :userId
     ) sub
     WHERE l.id = sub.id`,
    { replacements: { userId }, type: Ledger.sequelize.QueryTypes.UPDATE }
  );

  // Sync user.wallet to the net of all ledger rows. Failed or reversed
  // workflows are represented as compensating entries instead of mutable status.
  const rows = await Ledger.sequelize.query(
    `SELECT COALESCE(SUM(credit), 0) - COALESCE(SUM(debit), 0) AS ledger_balance
     FROM "Ledgers"
     WHERE user_id = :userId`,
    { replacements: { userId }, type: Ledger.sequelize.QueryTypes.SELECT }
  );

  const trueBalance = parseFloat(rows[0].ledger_balance) || 0;
  user.wallet = trueBalance;
  await user.save();

  return trueBalance;
}

/**
 * Recompute a user's wallet balance by rebuilding the full Ledger chain and
 * syncing user.wallet.  Returns a diff report useful for the reconcile endpoint.
 *
 * Fixes both:
 *   1. user.wallet drift — synced to the total ledger balance (SUM(credit) - SUM(debit)).
 *   2. balance_before / balance column drift on every Ledger row
 *
 * @param {number} userId
 * @returns {Promise<{user_id, true_balance, previous_wallet, drifted, corrected}>}
 */
async function recalculateBalance(userId) {
  const user = await User.findByPk(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const previousWallet = parseFloat(user.wallet) || 0;

  let releasedHolds = 0;

  // rebuildBalanceChain fixes ALL row-level balance fields AND syncs user.wallet
  const trueBalance = await rebuildBalanceChain(userId);

  const drifted = Math.abs(trueBalance - previousWallet) >= 0.01;

  return {
    user_id:         userId,
    true_balance:    trueBalance,
    previous_wallet: previousWallet,
    drifted,
    corrected:       drifted,
    released_stale_holds: releasedHolds,
  };
}

module.exports = {
  createLedgerEntry,
  createRazorpayChargeEntry,
  createWalletTransactionEntry,
  createCommissionEntry,
  createFranchiseEarningEntry,
  createRentalChargeEntry,
  createRentalCreditEntry,
  createPayoutEntry,
  getLedgerEntries,
  getLedgerEntryWithLinkedRecord,
  getLatestBalance,
  getAvailableBalance,
  rebuildBalanceChain,
  recalculateBalance
};


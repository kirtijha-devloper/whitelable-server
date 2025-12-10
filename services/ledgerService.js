const Ledger = require('../models/Ledger');
const User = require('../models/User');
const { Op } = require('sequelize');

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
 * Create a ledger entry
 * @param {Object} params - Ledger entry parameters
 * @param {number} params.userId - User ID
 * @param {string} params.transactionType - Type of transaction
 * @param {string} params.transactionId - Transaction ID (optional)
 * @param {number} params.referenceId - Reference ID (optional)
 * @param {string} params.description - Description
 * @param {number} params.debit - Debit amount (default: 0)
 * @param {number} params.credit - Credit amount (default: 0)
 * @param {string} params.status - Status (default: 'completed')
 * @param {Object} params.metadata - Additional metadata (optional)
 * @returns {Promise<Object>} Created ledger entry
 */
async function createLedgerEntry({
  userId,
  transactionType,
  transactionId = null,
  referenceId = null,
  description = null,
  debit = 0,
  credit = 0,
  status = 'completed',
  metadata = null
}) {
  // Validate that either debit or credit is provided, but not both
  if (debit > 0 && credit > 0) {
    throw new Error('Cannot have both debit and credit in the same ledger entry');
  }

  if (debit === 0 && credit === 0) {
    throw new Error('Either debit or credit must be greater than 0');
  }

  // Get current balance
  const currentBalance = await getLatestBalance(userId);

  // Calculate new balance
  const newBalance = currentBalance + credit - debit;

  // Prepare metadata
  let metadataString = null;
  if (metadata) {
    metadataString = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
  }

  // Create ledger entry
  const ledgerEntry = await Ledger.create({
    user_id: userId,
    transaction_type: transactionType,
    transaction_id: transactionId,
    reference_id: referenceId,
    description: description,
    debit: parseFloat(debit) || 0,
    credit: parseFloat(credit) || 0,
    balance: newBalance,
    status: status,
    metadata: metadataString
  });

  // Update user wallet balance to match ledger (for consistency)
  const user = await User.findByPk(userId);
  if (user) {
    user.wallet = newBalance;
    await user.save();
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
  netAmount,
  merchantTransactionChargeId = null,
  description = null,
  metadata = null
}) {
  // First, credit the full transaction amount
  await createLedgerEntry({
    userId,
    transactionType: 'razorpay_credit',
    transactionId: razorpayTransactionId,
    referenceId: merchantTransactionChargeId,
    description: description || `Razorpay transaction: ${razorpayTransactionId} - Amount: ₹${transactionAmount}`,
    credit: transactionAmount,
    status: 'completed',
    metadata: {
      transaction_amount: transactionAmount,
      ...metadata
    }
  });

  // Then, debit the charge amount (deduction)
  const chargeEntry = await createLedgerEntry({
    userId,
    transactionType: 'razorpay_charge',
    transactionId: razorpayTransactionId,
    referenceId: merchantTransactionChargeId,
    description: description || `Transaction charge deducted: ${razorpayTransactionId} - Charge: ₹${chargeAmount}`,
    debit: chargeAmount,
    status: 'completed',
    metadata: {
      transaction_amount: transactionAmount,
      charge_amount: chargeAmount,
      net_amount: netAmount,
      ...metadata
    }
  });

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
  status = 'completed',
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
      // Request doesn't change balance until approved
      if (status === 'completed') {
        credit = amount;
        ledgerTransactionType = 'wallet_credit';
      }
      break;
    case 'hold':
      debit = amount;
      ledgerTransactionType = 'wallet_debit';
      break;
    default:
      // Default to credit for unknown types
      credit = amount;
  }

  return await createLedgerEntry({
    userId,
    transactionType: ledgerTransactionType,
    transactionId: `wallet_${walletTransactionId}`,
    referenceId: walletTransactionId,
    description: description || `Wallet transaction: ${transactionType}`,
    debit,
    credit,
    status,
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
  status = null,
  page = 1,
  limit = 50
}) {
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const where = { user_id: userId };

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt[Op.gte] = new Date(startDate);
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setHours(23, 59, 59, 999);
      where.createdAt[Op.lte] = endDateObj;
    }
  }

  if (transactionType) {
    where.transaction_type = transactionType;
  }

  if (status) {
    where.status = status;
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

module.exports = {
  createLedgerEntry,
  createRazorpayChargeEntry,
  createWalletTransactionEntry,
  getLedgerEntries,
  getLatestBalance
};


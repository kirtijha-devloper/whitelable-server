const { Op } = require('sequelize');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const PayoutTransaction = require('../models/PayoutTransaction');
const Commission = require('../models/Commission');
const UserPayoutCharge = require('../models/UserPayoutCharge');
const PayoutCharge = require('../models/PayoutCharge');
const { normalizeRole } = require('../utils/permissions');

/**
 * Resolve payout fee rate for a given user and amount.
 * Checks UserPayoutCharge first, falls back to PayoutCharge global slab.
 */
async function resolveTierRate(userId, amount, dbTransaction = null) {
  const numAmount = parseFloat(amount || 0);
  if (userId) {
    try {
      const userRule = await UserPayoutCharge.findOne({
        where: {
          user_id: userId,
          is_active: true,
          from_amount: { [Op.lte]: numAmount },
          to_amount: { [Op.gte]: numAmount },
        },
        order: [['from_amount', 'DESC']],
        transaction: dbTransaction,
      });
      if (userRule) {
        return userRule.rate_type === 'flat'
          ? parseFloat(userRule.rate || 0)
          : parseFloat(((numAmount * parseFloat(userRule.rate || 0)) / 100).toFixed(2));
      }
    } catch (err) {
      // ignore
    }
  }

  try {
    const globalRule = await PayoutCharge.findOne({
      where: {
        is_active: true,
        from_amount: { [Op.lte]: numAmount },
        to_amount: { [Op.gte]: numAmount },
      },
      order: [['from_amount', 'DESC']],
      transaction: dbTransaction,
    });
    if (globalRule) {
      return globalRule.rate_type === 'flat'
        ? parseFloat(globalRule.rate || 0)
        : parseFloat(((numAmount * parseFloat(globalRule.rate || 0)) / 100).toFixed(2));
    }
  } catch (err) {
    // ignore
  }

  return 0;
}

/**
 * Distribute Payout Commission & Platform Margin across the hierarchy:
 * Merchant -> Franchise -> Super Franchise -> Admin -> Super Admin
 *
 * @param {Object} params
 * @param {Object} params.payoutTransaction  - PayoutTransaction record or ID
 * @param {number} params.merchantId         - Merchant user ID
 * @param {number} params.amount             - Payout principal amount
 * @param {number} params.serviceCharge      - Total service fee deducted from merchant
 * @param {string} [params.provider]         - Provider name ('Sevenpay', 'Ndia5', etc.)
 * @param {Object} [params.dbTransaction]    - Sequelize transaction
 */
async function distributePayoutCommission({
  payoutTransaction,
  merchantId,
  amount,
  serviceCharge,
  provider = 'Payout',
  dbTransaction = null,
}) {
  const totalFee = parseFloat(serviceCharge || 0);
  if (totalFee <= 0) return [];

  const txnAmount = parseFloat(amount || 0);
  const txnId = payoutTransaction?.id;
  const refId = payoutTransaction?.reference_id || `PAYOUT_${txnId || Date.now()}`;
  const companyId = payoutTransaction?.company_id || null;

  // 1. Fetch Merchant
  const merchant = await User.findByPk(merchantId, { transaction: dbTransaction });
  if (!merchant) return [];

  // 2. Resolve Full Hierarchy
  let franchise = null;
  if (merchant.franchaise_id) {
    franchise = await User.findByPk(merchant.franchaise_id, { transaction: dbTransaction });
  }

  let superFranchise = null;
  const superFranchiseId = merchant.super_franchise_id || franchise?.super_franchise_id;
  if (superFranchiseId) {
    superFranchise = await User.findByPk(superFranchiseId, { transaction: dbTransaction });
  }

  // Find Admin
  const admin = await User.findOne({
    where: { role: 'admin' },
    order: [['id', 'ASC']],
    transaction: dbTransaction,
  });

  // Find Super Admin (role === 'super_admin' or is_super_admin: true, fallback to primary admin)
  let superAdmin = await User.findOne({
    where: {
      [Op.or]: [
        { role: 'super_admin' },
        { is_super_admin: true },
      ],
    },
    order: [['id', 'ASC']],
    transaction: dbTransaction,
  });
  if (!superAdmin) {
    superAdmin = admin;
  }

  // 3. Calculate Commission Margins
  // Base rates can be dynamically resolved from UserPayoutCharge / PayoutCharge
  let franchiseBase = franchise ? await resolveTierRate(franchise.id, txnAmount, dbTransaction) : 0;
  let superFranchiseBase = superFranchise ? await resolveTierRate(superFranchise.id, txnAmount, dbTransaction) : 0;

  let franchiseComm = 0;
  let superFranchiseComm = 0;
  let superAdminProfit = 0;

  if (franchiseBase > 0 && franchiseBase < totalFee) {
    franchiseComm = parseFloat((totalFee - franchiseBase).toFixed(2));
  }
  if (superFranchiseBase > 0 && superFranchise && franchiseBase > superFranchiseBase) {
    superFranchiseComm = parseFloat((franchiseBase - superFranchiseBase).toFixed(2));
  }

  // Fallback tiered percentage split if intermediate rates are not explicitly configured
  if (franchise && franchiseComm <= 0) {
    if (superFranchise) {
      franchiseComm = parseFloat((totalFee * 0.30).toFixed(2));
      superFranchiseComm = parseFloat((totalFee * 0.20).toFixed(2));
    } else {
      franchiseComm = parseFloat((totalFee * 0.40).toFixed(2));
    }
  } else if (superFranchise && superFranchiseComm <= 0) {
    superFranchiseComm = parseFloat((totalFee * 0.30).toFixed(2));
  }

  // Remaining margin goes to Super Admin (Platform Profit)
  const distributedSoFar = parseFloat((franchiseComm + superFranchiseComm).toFixed(2));
  superAdminProfit = parseFloat((totalFee - distributedSoFar).toFixed(2));
  if (superAdminProfit < 0) {
    superAdminProfit = 0;
  }

  const results = [];

  // Helper to credit a recipient wallet and create Ledger + Commission records
  async function creditRecipient(recipient, commAmount, typeName, roleName) {
    if (!recipient || commAmount <= 0) return;

    let currentBal = parseFloat(recipient.wallet || 0);
    try {
      const latestLedger = await Ledger.findOne({
        where: { user_id: recipient.id },
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        transaction: dbTransaction,
      });
      if (latestLedger && latestLedger.balance !== null && latestLedger.balance !== undefined) {
        currentBal = parseFloat(latestLedger.balance) || 0;
      }
    } catch (e) {
      // fallback to recipient.wallet
    }
    const newBal = parseFloat((currentBal + commAmount).toFixed(2));

    // Update wallet
    await User.update(
      { wallet: newBal },
      { where: { id: recipient.id }, transaction: dbTransaction }
    );

    // Create Ledger entry
    const ledgerEntry = await Ledger.create({
      user_id: recipient.id,
      company_id: companyId || recipient.company_id || null,
      transaction_type: typeName,
      transaction_id: `COMM_${refId}_${recipient.id}`,
      reference_id: txnId || null,
      reference_table: 'PayoutTransactions',
      description: `${roleName} payout commission from ${merchant.name || ('Merchant #' + merchantId)} on ${refId}`,
      balance_before: currentBal,
      credit: commAmount,
      debit: 0,
      balance: newBal,
      metadata: JSON.stringify({
        payout_id: txnId || null,
        payout_reference: refId,
        payout_amount: txnAmount,
        service_charge: totalFee,
        commission_amount: commAmount,
        provider,
        merchant_id: merchantId,
        merchant_name: merchant.name,
        beneficiary_role: roleName,
      }),
    }, { transaction: dbTransaction });

    // Record in commissions table for reports
    try {
      await Commission.create({
        transaction_id: String(refId),
        utr_no: payoutTransaction?.utr || null,
        user_id: recipient.id,
        user_role: recipient.role,
        service_key: 'payout',
        payment_mode: 'IMPS',
        txn_amount: txnAmount,
        applied_rate: String(commAmount),
        commission_amount: commAmount,
        platform_margin: roleName === 'Super Admin' ? commAmount : 0,
        status: 'CREDITED',
      }, { transaction: dbTransaction });
    } catch (commErr) {
      console.warn('[PayoutCommission] Failed to record commission row:', commErr.message);
    }

    results.push({
      recipient_id: recipient.id,
      role: roleName,
      amount: commAmount,
      balance_after: newBal,
      ledger_id: ledgerEntry.id,
    });
  }

  // 4. Execute Credits
  // A. Franchise Credit
  if (franchise && franchiseComm > 0) {
    await creditRecipient(franchise, franchiseComm, 'payout_commission', 'Franchise');
  }

  // B. Super Franchise Credit
  if (superFranchise && superFranchiseComm > 0) {
    await creditRecipient(superFranchise, superFranchiseComm, 'payout_commission', 'Super Franchise');
  }

  // C. Super Admin / Platform Profit Credit
  if (superAdmin && superAdminProfit > 0) {
    await creditRecipient(superAdmin, superAdminProfit, 'payout_profit', 'Super Admin');
  }

  return results;
}

module.exports = {
  distributePayoutCommission,
};

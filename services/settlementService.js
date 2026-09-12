const db = require('../config/database');
const { Op } = require('sequelize');

/**
 * Normalizes settlement type input to standard 'T0' or 'T1'
 */
function normalizeSettlementType(type) {
  if (!type) return 'T0';
  const upper = String(type).trim().toUpperCase();
  if (upper === 'T1' || upper === 'NEXT_DAY_SETTLEMENT') {
    return 'T1';
  }
  return 'T0';
}

/**
 * Resolves the effective settlement mode ('T0' or 'T1') for a merchant transaction,
 * enforcing daily T0 limit rules with automatic shift to T1 if limit is exceeded.
 *
 * @param {Object} opts
 * @param {Object} opts.user - Merchant User instance or object with id, settlement_type, t0_daily_limit
 * @param {number} [opts.incomingTxnAmount=0] - Amount of the incoming transaction
 * @param {Date|string} [opts.date] - Optional date to check daily limit against (default today)
 * @returns {Promise<Object>} { effectiveSettlement: 'T0'|'T1', isLimitExceeded: boolean, todayT0Total: number, projectedTotal: number, t0Limit: number|null, note: string|null }
 */
async function resolveEffectiveSettlement({ user, incomingTxnAmount = 0, date = new Date() }) {
  if (!user) {
    return {
      effectiveSettlement: 'T0',
      isLimitExceeded: false,
      todayT0Total: 0,
      projectedTotal: parseFloat(incomingTxnAmount) || 0,
      t0Limit: null,
      note: null,
    };
  }

  const rawSettlement = user.settlement_type || 'T0';
  const settlementMode = normalizeSettlementType(rawSettlement);

  if (settlementMode === 'T1') {
    return {
      effectiveSettlement: 'T1',
      isLimitExceeded: false,
      todayT0Total: 0,
      projectedTotal: parseFloat(incomingTxnAmount) || 0,
      t0Limit: user.t0_daily_limit !== undefined && user.t0_daily_limit !== null ? parseFloat(user.t0_daily_limit) : null,
      note: 'User set to T1 settlement',
    };
  }

  // User configured as T0 -> Check T0 Daily Limit
  const t0Limit = (user.t0_daily_limit !== undefined && user.t0_daily_limit !== null)
    ? parseFloat(user.t0_daily_limit)
    : null;

  if (t0Limit !== null && !isNaN(t0Limit) && t0Limit >= 0) {
    const RazorpayNotification = require('../models/RazorpayNotification');

    const today = new Date(date);
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const sumResult = await RazorpayNotification.sum('amount', {
      where: {
        user_id: user.id,
        status: {
          [Op.in]: ['CAPTURED', 'SUCCESS', 'AUTHORIZED']
        },
        settlement_type: {
          [Op.in]: ['T0', 'today_settlement']
        },
        createdAt: {
          [Op.between]: [startOfDay, endOfDay]
        }
      }
    });

    const todayT0Total = parseFloat(sumResult) || 0;
    const txnAmount = parseFloat(incomingTxnAmount) || 0;
    const projectedTotal = todayT0Total + txnAmount;

    if (projectedTotal > t0Limit) {
      const note = `T0 Limit exceeded (Projected ₹${projectedTotal} > Limit ₹${t0Limit})`;
      return {
        effectiveSettlement: 'T1',
        isLimitExceeded: true,
        todayT0Total,
        projectedTotal,
        t0Limit,
        note,
      };
    }

    return {
      effectiveSettlement: 'T0',
      isLimitExceeded: false,
      todayT0Total,
      projectedTotal,
      t0Limit,
      note: null,
    };
  }

  // Limit is null -> Unlimited T0
  return {
    effectiveSettlement: 'T0',
    isLimitExceeded: false,
    todayT0Total: 0,
    projectedTotal: parseFloat(incomingTxnAmount) || 0,
    t0Limit: null,
    note: null,
  };
}

module.exports = {
  normalizeSettlementType,
  resolveEffectiveSettlement,
};

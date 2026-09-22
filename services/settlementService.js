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
  let rawLimit = (user.t0_daily_limit !== undefined && user.t0_daily_limit !== null)
    ? parseFloat(user.t0_daily_limit)
    : 0;

  if (isNaN(rawLimit) || rawLimit < 0) {
    rawLimit = 0;
  }

  let t0Limit = rawLimit;

  // For franchise users, the t0_daily_limit represents the total pool assigned by admin.
  // The franchise's effective self-limit is: pool - sum(downstream merchants' t0_daily_limits).
  if (user.role === 'franchaise') {
    if (rawLimit > 0) {
      const User = require('../models/User');
      const downstreamMerchants = await User.findAll({
        where: {
          franchaise_id: user.id,
          role: 'merchant',
          t0_daily_limit: { [Op.not]: null }
        },
        attributes: ['t0_daily_limit']
      });
      const allocatedToMerchants = downstreamMerchants.reduce((sum, m) => {
        const mLimit = parseFloat(m.t0_daily_limit);
        return sum + (isNaN(mLimit) ? 0 : mLimit);
      }, 0);
      t0Limit = Math.max(0, rawLimit - allocatedToMerchants);
    } else {
      t0Limit = 0;
    }
  }

  if (t0Limit <= 0) {
    return {
      effectiveSettlement: 'T1',
      isLimitExceeded: true,
      todayT0Total: 0,
      projectedTotal: parseFloat(incomingTxnAmount) || 0,
      t0Limit: 0,
      note: 'T0 Daily Limit is 0 or not assigned. Shifted to T1.',
    };
  }

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

/**
 * Checks whether current time (IST / local) has passed effective cutoff time (Format HH:mm)
 */
function checkIsCutoffPassed(effectiveCutoff, now = new Date()) {
  if (!effectiveCutoff) return true;
  const parts = String(effectiveCutoff).trim().split(':');
  if (parts.length < 2) return true;
  const cutoffHours = parseInt(parts[0], 10);
  const cutoffMinutes = parseInt(parts[1], 10);

  let currentHours, currentMinutes;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const formattedParts = formatter.formatToParts(now);
    const h = formattedParts.find(p => p.type === 'hour');
    const m = formattedParts.find(p => p.type === 'minute');
    currentHours = parseInt(h.value, 10) % 24;
    currentMinutes = parseInt(m.value, 10);
  } catch (e) {
    currentHours = now.getHours();
    currentMinutes = now.getMinutes();
  }

  const currentTotalMins = currentHours * 60 + currentMinutes;
  const cutoffTotalMins = cutoffHours * 60 + cutoffMinutes;

  return currentTotalMins >= cutoffTotalMins;
}

/**
 * Calculates usable main wallet balance based on cutoff rules
 */
async function getUsableMainWalletBalance(userId, now = new Date()) {
  const User = require('../models/User');
  const SystemSettlementConfig = require('../models/SystemSettlementConfig');

  const user = (typeof userId === 'object' && userId !== null && userId.id)
    ? userId
    : await User.findByPk(userId);

  if (!user) return 0;

  let globalConfig;
  try {
    globalConfig = await SystemSettlementConfig.findOne({ where: { id: 1 } });
  } catch (err) {
    globalConfig = null;
  }

  const totalMainWallet = parseFloat(user.wallet) || 0;
  const prevDaySettled = parseFloat(user.prev_day_settled_balance) || 0;

  // 1. If global cutoff is OFF, full wallet balance is usable
  if (globalConfig && !globalConfig.global_cutoff_enabled) {
    return totalMainWallet;
  }

  // 2. Check user cutoff time vs current time
  const effectiveCutoff = user.cutoff_timestamp || (globalConfig ? globalConfig.global_default_cutoff_time : '10:00');
  const isCutoffPassed = checkIsCutoffPassed(effectiveCutoff, now);

  // 3. Lock Rule
  if (isCutoffPassed) {
    // After Cutoff: Entire main wallet is unlocked & usable
    return totalMainWallet;
  } else {
    // Before Cutoff: User can ONLY spend up to Previous Day Settled Funds
    return Math.min(totalMainWallet, prevDaySettled);
  }
}

/**
 * Deducts amount from user wallet according to cutoff debit priority rules
 */
async function deductUsableBalance({ userId, amount, transaction = null, now = new Date() }) {
  const User = require('../models/User');
  const SystemSettlementConfig = require('../models/SystemSettlementConfig');

  const user = await User.findByPk(userId, { transaction });
  if (!user) {
    throw new Error('User not found');
  }

  const reqAmount = parseFloat(amount);
  if (isNaN(reqAmount) || reqAmount <= 0) {
    throw new Error('Invalid deduction amount');
  }

  const usableBalance = await getUsableMainWalletBalance(user, now);
  if (reqAmount > usableBalance) {
    throw new Error(`Insufficient usable balance. Available: ₹${usableBalance.toFixed(2)}, Requested: ₹${reqAmount.toFixed(2)}`);
  }

  let globalConfig;
  try {
    globalConfig = await SystemSettlementConfig.findOne({ where: { id: 1 }, transaction });
  } catch (err) {
    globalConfig = null;
  }

  const cutoffEnabled = globalConfig ? globalConfig.global_cutoff_enabled : true;
  const effectiveCutoff = user.cutoff_timestamp || (globalConfig ? globalConfig.global_default_cutoff_time : '10:00');
  const isCutoffPassed = checkIsCutoffPassed(effectiveCutoff, now);

  user.wallet = (parseFloat(user.wallet) || 0) - reqAmount;

  if (cutoffEnabled && !isCutoffPassed) {
    const currentPrevDay = parseFloat(user.prev_day_settled_balance) || 0;
    const deductFromPrev = Math.min(currentPrevDay, reqAmount);
    user.prev_day_settled_balance = currentPrevDay - deductFromPrev;
  }

  await user.save({ transaction });
  return user;
}

module.exports = {
  normalizeSettlementType,
  resolveEffectiveSettlement,
  checkIsCutoffPassed,
  getUsableMainWalletBalance,
  deductUsableBalance,
};

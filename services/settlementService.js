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

const serviceSettingsService = require('./serviceSettingsService');

/**
 * Dynamic Settlement Evaluator
 * Evaluates dynamic settlement mode ('T0' or 'T1') based on:
 * 1. Global Service Flag ("pos_t0_settlement")
 * 2. Assigned user limit (user.t0_daily_limit)
 * 3. Incoming transaction amount & today's cumulative T0 total
 */
async function evaluateDynamicSettlement({ user, transactionAmount = 0, todayT0Sum = 0 }) {
  const isGlobalT0Enabled = await serviceSettingsService.getServiceFlagValue("pos_t0_settlement", true);
  const amount = Number(transactionAmount) || 0;
  const currentT0Sum = Number(todayT0Sum) || 0;

  if (!user) {
    return {
      settlementType: "T0",
      appliedRate: "T0",
      isGlobalT0Enabled: true,
      isLimitExceeded: false,
      reason: "No user provided -> Default T0"
    };
  }

  const staticMode = normalizeSettlementType(user.settlement_type);

  // 1. IF Global Switch is OFF OR User static DB mode is T1:
  if (!isGlobalT0Enabled || staticMode === 'T1') {
    const effectiveMode = staticMode;
    return {
      settlementType: effectiveMode,
      appliedRate: effectiveMode,
      isGlobalT0Enabled,
      isLimitExceeded: false,
      reason: !isGlobalT0Enabled
        ? `Global T0 switch OFF. Used static DB mode (${effectiveMode}).`
        : 'User set to T1 settlement'
    };
  }

  // 2. IF Global Switch is ON and User is T0 mode: evaluate limits
  const rawLimit = user.t0_daily_limit;
  const isLimitAssigned =
    rawLimit !== null &&
    rawLimit !== undefined &&
    rawLimit !== "" &&
    String(rawLimit).toLowerCase() !== "unlimited";

  let t0Limit = isLimitAssigned ? Number(rawLimit) : null;

  // Franchise self-limit adjustment
  if (user.role === 'franchaise') {
    const rawNum = parseFloat(user.t0_daily_limit) || 0;
    if (rawNum > 0) {
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
      t0Limit = Math.max(0, rawNum - allocatedToMerchants);
    } else {
      t0Limit = 0;
    }
  }

  // Unlimited limit -> Dynamic T0
  if (typeof rawLimit === 'string' && rawLimit.toLowerCase() === 'unlimited') {
    return {
      settlementType: "T0",
      appliedRate: "T0",
      isGlobalT0Enabled: true,
      isLimitExceeded: false,
      t0Limit: null,
      reason: "Unlimited T0 Limit -> Dynamic T0"
    };
  }

  // Unassigned limit or ₹0 limit -> Dynamic T1
  if (!isLimitAssigned || t0Limit === 0 || isNaN(t0Limit)) {
    return {
      settlementType: "T1",
      appliedRate: "T1",
      isGlobalT0Enabled: true,
      isLimitExceeded: true,
      t0Limit: t0Limit !== null ? t0Limit : 0,
      reason: !isLimitAssigned ? "T0 Limit Unassigned -> Dynamic T1" : "T0 Daily Limit is 0 or not assigned. Shifted to T1."
    };
  }

  // Check projected total against assigned limit
  const projectedTotal = currentT0Sum + amount;
  if (amount > t0Limit || projectedTotal > t0Limit) {
    return {
      settlementType: "T1",
      appliedRate: "T1",
      isGlobalT0Enabled: true,
      isLimitExceeded: true,
      t0Limit,
      reason: `T0 Limit exceeded (Projected ₹${projectedTotal} > Limit ₹${t0Limit})`
    };
  }

  // Within limit -> Dynamic T0
  return {
    settlementType: "T0",
    appliedRate: "T0",
    isGlobalT0Enabled: true,
    isLimitExceeded: false,
    t0Limit,
    reason: "Within T0 Limit -> Dynamic T0"
  };
}

/**
 * Resolves the effective settlement mode ('T0' or 'T1') for a merchant transaction,
 * enforcing daily T0 limit rules with automatic shift to T1 if limit is exceeded.
 */
async function resolveEffectiveSettlement({ user, incomingTxnAmount = 0, date = new Date() }) {
  if (!user) {
    return {
      effectiveSettlement: 'T0',
      settlementType: 'T0',
      appliedRate: 'T0',
      isGlobalT0Enabled: true,
      isLimitExceeded: false,
      todayT0Total: 0,
      projectedTotal: parseFloat(incomingTxnAmount) || 0,
      t0Limit: null,
      note: null,
    };
  }

  const RazorpayNotification = require('../models/RazorpayNotification');

  const today = new Date(date);
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  let todayT0Total = 0;
  try {
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
    todayT0Total = parseFloat(sumResult) || 0;
  } catch (err) {
    todayT0Total = 0;
  }

  const txnAmount = parseFloat(incomingTxnAmount) || 0;

  const dynResult = await evaluateDynamicSettlement({
    user,
    transactionAmount: txnAmount,
    todayT0Sum: todayT0Total
  });

  const effectiveSettlement = dynResult.settlementType;

  return {
    effectiveSettlement,
    settlementType: effectiveSettlement,
    appliedRate: dynResult.appliedRate,
    isGlobalT0Enabled: dynResult.isGlobalT0Enabled,
    isLimitExceeded: Boolean(dynResult.isLimitExceeded),
    todayT0Total,
    projectedTotal: todayT0Total + txnAmount,
    t0Limit: dynResult.t0Limit !== undefined && dynResult.t0Limit !== null ? dynResult.t0Limit : 0,
    note: dynResult.reason,
  };
}

/**
 * Validates requested T0 daily limit for a user (Franchise or Merchant)
 * 1. Ensures requested limit is NOT less than the user's total committed/utilized limit:
 *    - For Franchise: min limit = (allocated to merchants) + (utilized today by franchise)
 *    - For Merchant: min limit = (utilized today by merchant)
 * 2. If target user is a Merchant, ensures requested limit does NOT exceed parent Franchise's available pool:
 *    - available pool = Franchise pool - (allocated to other merchants) - (utilized today by parent franchise)
 * Throws an error with status/statusCode 400 if validation fails.
 */
async function validateMerchantT0Limit({ targetUser, requestedLimit, requesterUser }) {
  if (!targetUser) return;

  const User = require('../models/User');
  const RazorpayNotification = require('../models/RazorpayNotification');

  let requestedLimitVal = 0;
  if (requestedLimit !== null && requestedLimit !== undefined && requestedLimit !== '') {
    requestedLimitVal = parseFloat(requestedLimit);
    if (isNaN(requestedLimitVal) || requestedLimitVal < 0) {
      const err = new Error('t0_daily_limit must be a valid non-negative number or null');
      err.status = 400;
      err.statusCode = 400;
      throw err;
    }
  }

  const targetRole = String(targetUser.role || '').toLowerCase();
  const isTargetFranchise = targetRole === 'franchise' || targetRole === 'franchaise';

  // 1. Calculate amount utilized today by targetUser (T0 transactions executed today)
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  let targetUsedToday = 0;
  try {
    const targetUsedRaw = await RazorpayNotification.sum('amount', {
      where: {
        user_id: targetUser.id,
        status: { [Op.in]: ['CAPTURED', 'SUCCESS', 'AUTHORIZED'] },
        settlement_type: { [Op.in]: ['T0', 'today_settlement'] },
        createdAt: { [Op.between]: [startOfDay, endOfDay] }
      }
    });
    targetUsedToday = parseFloat(targetUsedRaw) || 0;
  } catch (err) {
    targetUsedToday = 0;
  }

  // 2. Calculate amount allocated to downstream merchants if targetUser is a Franchise
  let allocatedToMerchants = 0;
  if (isTargetFranchise) {
    const downstreamMerchants = await User.findAll({
      where: {
        franchaise_id: targetUser.id,
        role: { [Op.in]: ['merchant', 'user'] },
        t0_daily_limit: { [Op.not]: null }
      },
      attributes: ['t0_daily_limit']
    });

    allocatedToMerchants = downstreamMerchants.reduce((sum, m) => {
      const l = parseFloat(m.t0_daily_limit);
      return sum + (isNaN(l) ? 0 : l);
    }, 0);
  }

  // 3. Minimum allowable limit for targetUser
  const minRequiredLimit = allocatedToMerchants + targetUsedToday;

  if (requestedLimitVal < minRequiredLimit) {
    let msg = '';
    if (isTargetFranchise) {
      const details = [];
      if (allocatedToMerchants > 0) details.push(`Allocated to merchants: ₹${allocatedToMerchants}`);
      if (targetUsedToday > 0) details.push(`Utilized today: ₹${targetUsedToday}`);
      msg = `Franchise limit cannot be set lower than ₹${minRequiredLimit} as it is already utilized/allocated (${details.join(', ')}).`;
    } else {
      msg = `Merchant limit cannot be set lower than ₹${targetUsedToday} as ₹${targetUsedToday} has already been utilized today.`;
    }
    const err = new Error(msg);
    err.status = 400;
    err.statusCode = 400;
    throw err;
  }

  // 4. If targetUser is a Merchant, validate against Parent Franchise pool
  const requesterRole = String(requesterUser?.role || '').toLowerCase();
  const isFranchiseRequester = requesterRole === 'franchise' || requesterRole === 'franchaise';

  let franchiseId = targetUser.franchaise_id;
  if (!franchiseId && isFranchiseRequester && !isTargetFranchise) {
    franchiseId = requesterUser.id;
  }

  if (franchiseId && !isTargetFranchise) {
    const parentFranchise = await User.findByPk(franchiseId);
    if (parentFranchise) {
      const franchisePool = (parentFranchise.t0_daily_limit !== null && parentFranchise.t0_daily_limit !== undefined)
        ? parseFloat(parentFranchise.t0_daily_limit)
        : 0;

      if (franchisePool <= 0 && requestedLimitVal > 0) {
        const err = new Error('Parent Franchise pool is 0 or Not Set. Admin must first assign a T0 pool limit to Franchise before assigning limit to merchant.');
        err.status = 400;
        err.statusCode = 400;
        throw err;
      }

      // Calculate sum of t0_daily_limit for all OTHER merchants under this franchise
      const otherMerchants = await User.findAll({
        where: {
          franchaise_id: franchiseId,
          role: { [Op.in]: ['merchant', 'user'] },
          id: { [Op.ne]: targetUser.id },
          t0_daily_limit: { [Op.not]: null }
        },
        attributes: ['t0_daily_limit']
      });

      const otherAllocated = otherMerchants.reduce((sum, m) => {
        const l = parseFloat(m.t0_daily_limit);
        return sum + (isNaN(l) ? 0 : l);
      }, 0);

      // Sum of transactions used by parent Franchise itself today
      let parentUsedToday = 0;
      try {
        const parentUsedRaw = await RazorpayNotification.sum('amount', {
          where: {
            user_id: parentFranchise.id,
            status: { [Op.in]: ['CAPTURED', 'SUCCESS', 'AUTHORIZED'] },
            settlement_type: { [Op.in]: ['T0', 'today_settlement'] },
            createdAt: { [Op.between]: [startOfDay, endOfDay] }
          }
        });
        parentUsedToday = parseFloat(parentUsedRaw) || 0;
      } catch (err) {
        parentUsedToday = 0;
      }

      const availableForMerchant = Math.max(0, franchisePool - otherAllocated - parentUsedToday);

      if (requestedLimitVal > availableForMerchant) {
        const err = new Error(`Limit pool of Franchise (₹${franchisePool}) exceeded! Maximum limit available to assign to this merchant is ₹${availableForMerchant}.` + (parentUsedToday > 0 ? ` (Franchise utilized ₹${parentUsedToday} today)` : ''));
        err.status = 400;
        err.statusCode = 400;
        throw err;
      }
    }
  }
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
  evaluateDynamicSettlement,
  resolveEffectiveSettlement,
  validateMerchantT0Limit,
  checkIsCutoffPassed,
  getUsableMainWalletBalance,
  deductUsableBalance,
};

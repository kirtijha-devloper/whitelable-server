const { Op } = require('sequelize');
const Company = require('../models/Company');
const User = require('../models/User');
const PayoutTransaction = require('../models/PayoutTransaction');

/**
 * Returns IST Midnight (00:00:00) converted to UTC Date.
 * Ensures all daily calculations strictly follow Indian Standard Time (UTC+05:30).
 */
function getTodayStartIST() {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffsetMs);
  const startOfDayUtc = new Date(
    Date.UTC(istTime.getUTCFullYear(), istTime.getUTCMonth(), istTime.getUTCDate(), 0, 0, 0) - istOffsetMs
  );
  return startOfDayUtc;
}

/**
 * Calculates today's utilized payout amount for a company and its remaining limit.
 *
 * @param {Object} options
 * @param {string|number} [options.companyId] - Company identifier string or ID
 * @param {Object} [options.user] - User object
 * @param {number|string} [options.userId] - User ID
 * @param {Object} [options.dbTransaction] - Active Sequelize transaction
 * @returns {Promise<{ company: Object|null, limit: number, todayUsed: number, remaining: number|null }>}
 */
async function getCompanyPayoutDailyStats({ companyId, user, userId, dbTransaction = null }) {
  let resolvedUser = user;
  if (!resolvedUser && userId) {
    resolvedUser = await User.findByPk(userId, { transaction: dbTransaction });
  }

  const resolvedCompanyId = companyId || resolvedUser?.company_id;
  let company = null;

  if (resolvedCompanyId) {
    company = await Company.findOne({
      where: { company_id: resolvedCompanyId },
      transaction: dbTransaction,
      lock: dbTransaction ? dbTransaction.LOCK.UPDATE : undefined,
    });
  }

  if (!company && resolvedUser?.id) {
    company = await Company.findOne({
      where: { user_id: resolvedUser.id },
      transaction: dbTransaction,
      lock: dbTransaction ? dbTransaction.LOCK.UPDATE : undefined,
    });
  }

  if (!company) {
    return { company: null, limit: 0, todayUsed: 0, remaining: null };
  }

  const rawLimit = company.payout_limit;
  const limitNumber = rawLimit !== null && rawLimit !== undefined && rawLimit !== ''
    ? Number(rawLimit)
    : 0;

  // Find all users belonging to this company
  const companyUsers = await User.findAll({
    where: { company_id: company.company_id },
    attributes: ['id'],
    transaction: dbTransaction,
  });

  const userIds = companyUsers.map((u) => u.id);
  if (company.user_id && !userIds.includes(company.user_id)) {
    userIds.push(company.user_id);
  }
  if (resolvedUser?.id && !userIds.includes(resolvedUser.id)) {
    userIds.push(resolvedUser.id);
  }

  const startOfDay = getTodayStartIST();

  const todayUsedRaw = await PayoutTransaction.sum('amount', {
    where: {
      merchant_id: { [Op.in]: userIds },
      status: {
        [Op.notIn]: ['FAILED', 'FAILURE', 'CANCELLED', 'REVERSED', 'DECLINED'],
      },
      createdAt: { [Op.gte]: startOfDay },
    },
    transaction: dbTransaction,
  });

  const todayUsed = Number(todayUsedRaw || 0);

  // If limit <= 0, no cap is configured (unlimited)
  if (!Number.isFinite(limitNumber) || limitNumber <= 0) {
    return { company, limit: 0, todayUsed, remaining: null };
  }

  const remaining = Math.max(0, +(limitNumber - todayUsed).toFixed(2));

  return { company, limit: limitNumber, todayUsed, remaining };
}

/**
 * Validates whether a requested payout amount is permitted under the company's daily payout limit.
 *
 * @param {Object} options
 * @param {Object} [options.user] - Requesting User object
 * @param {number|string} [options.userId] - Requesting User ID
 * @param {string|number} [options.companyId] - Company ID
 * @param {number|string} options.amount - Requested payout amount
 * @param {Object} [options.dbTransaction] - Active Sequelize transaction
 * @returns {Promise<{ allowed: boolean, limit: number, todayUsed: number, remaining: number|null, message?: string }>}
 */
async function validateCompanyPayoutLimit({ user, userId, companyId, amount, dbTransaction = null }) {
  const reqAmount = Number(amount);
  if (!Number.isFinite(reqAmount) || reqAmount <= 0) {
    return { allowed: true, limit: 0, todayUsed: 0, remaining: null };
  }

  const stats = await getCompanyPayoutDailyStats({
    user,
    userId,
    companyId,
    dbTransaction,
  });

  // If company not found or limit is not set / 0, allow
  if (!stats.company || stats.limit <= 0) {
    return {
      allowed: true,
      limit: stats.limit,
      todayUsed: stats.todayUsed,
      remaining: null,
    };
  }

  const remaining = stats.remaining;

  if (reqAmount > remaining || (stats.todayUsed + reqAmount) > stats.limit) {
    return {
      allowed: false,
      limit: stats.limit,
      todayUsed: stats.todayUsed,
      remaining,
      message: `Company daily payout limit of ₹${stats.limit.toLocaleString('en-IN')} exceeded. Total payouts executed today: ₹${stats.todayUsed.toLocaleString('en-IN')}, Remaining limit available: ₹${remaining.toLocaleString('en-IN')}. Please contact Admin.`,
    };
  }

  return {
    allowed: true,
    limit: stats.limit,
    todayUsed: stats.todayUsed,
    remaining: Math.max(0, +(remaining - reqAmount).toFixed(2)),
  };
}

module.exports = {
  validateCompanyPayoutLimit,
  getCompanyPayoutDailyStats,
  getTodayStartIST,
};


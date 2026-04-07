const asyncHandler = require("express-async-handler");
const { Op } = require('sequelize');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const RazorpayNotification = require('../models/RazorpayNotification');
const WalletTransaction = require("../models/WalletTransaction");


const getTodayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const buildRazorpayDateRange = (start, end) => ({
  [Op.or]: [
    { posting_date: { [Op.between]: [start, end] } },
    { posting_date: null, createdAt: { [Op.between]: [start, end] } }
  ]
});

const getRazorpayTransactionStats = async (whereClause) => {
  if (!whereClause) {
    return { total: 0, success: 0, fail: 0, count: 0, success_rate: 0, failure_rate: 0 };
  }

  const [count, totalRaw, successRaw, failRaw] = await Promise.all([
    RazorpayNotification.count({ where: whereClause }),
    RazorpayNotification.sum('amount', { where: whereClause }),
    RazorpayNotification.sum('amount', {
      where: {
        ...whereClause,
        status: { [Op.in]: ['CAPTURED', 'AUTHORIZED', 'SETTLED'] }
      }
    }),
    RazorpayNotification.sum('amount', {
      where: {
        ...whereClause,
        status: { [Op.in]: ['FAILED', 'VOIDED', 'DECLINED'] }
      }
    })
  ]);

  const total = Number(totalRaw || 0);
  const success = Number(successRaw || 0);
  const fail = Number(failRaw || 0);
  const countVal = Number(count || 0);

  return {
    total,
    success,
    fail,
    count: countVal,
    success_rate: total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0,
    failure_rate: total > 0 ? Number(((fail / total) * 100).toFixed(2)) : 0
  };
};

const getDashboard = asyncHandler(async (req, res) => {
  const role = req.user.role;
  const userId = req.user.id;
  const { start, end } = getTodayRange();

  try {
    let data = {};

    const dateWhere = buildRazorpayDateRange(start, end);

    if (role === 'admin') {
      const [activeMachineCount, deactiveMachineCount, activeMerchantCount, activeFranchaiseCount] =
        await Promise.all([
          PosMachine.count({ where: { status: { [Op.ne]: 'in_active' } } }),
          PosMachine.count({ where: { status: 'in_active' } }),
          User.count({ where: { role: 'merchant', status: 'active' } }),
          User.count({ where: { role: 'franchaise', status: 'active' } })
        ]);

      const posStats = await getRazorpayTransactionStats(dateWhere);

      const today_total_payout = await WalletTransaction.sum('amount', {
        where: {
          status: 'completed',
          type: { [Op.in]: ['transfer', 'unhold'] },
          createdAt: { [Op.between]: [start, end] }
        }
      });

      data = {
        pos_machines: { active: activeMachineCount, inactive: deactiveMachineCount },
        merchants: { count: activeMerchantCount },
        franchaises: { count: activeFranchaiseCount },
        pos_transactions: {
          total: posStats.total,
          success: posStats.success,
          fail: posStats.fail,
          count: posStats.count,
          success_rate: posStats.success_rate,
          failure_rate: posStats.failure_rate
        },
        today_total_payout: Number(today_total_payout || 0)
      };
    }

    if (role === 'franchaise') {
      const machines = await PosMachine.findAll({
        where: { assigned_to: userId },
        attributes: ['mid_number'],
        raw: true
      });
      const mids = machines.map((machine) => machine.mid_number).filter(Boolean);

      const franchiseMerchantIds = await User.findAll({
        where: { franchaise_id: userId, role: 'merchant', status: 'active' },
        attributes: ['id'],
        raw: true
      }).then((rows) => rows.map((r) => r.id));

      const [assignedMerchantCount, posMachineCount, merchantAssignedPosMachineCount] = await Promise.all([
        User.count({ where: { franchaise_id: userId, role: 'merchant', status: 'active' } }),
        PosMachine.count({ where: { assigned_to: userId } }),
        franchiseMerchantIds.length > 0
          ? PosMachine.count({ where: { assigned_to: { [Op.in]: franchiseMerchantIds } } })
          : 0
      ]);

      const franchiseRoleFilter = (franchiseMerchantIds.length > 0 || mids.length > 0)
        ? {
          [Op.or]: [
            ...(franchiseMerchantIds.length ? [{ user_id: { [Op.in]: franchiseMerchantIds } }] : []),
            ...(mids.length ? [{ mid: { [Op.in]: mids } }] : [])
          ]
        }
        : { user_id: -1 };

      const posStats = await getRazorpayTransactionStats({ [Op.and]: [dateWhere, franchiseRoleFilter] });

      const today_total_payout = await WalletTransaction.sum('amount', {
        where: {
          requested_by: req.user.id,
          status: 'completed',
          type: { [Op.in]: ['transfer', 'hold'] },
          createdAt: { [Op.between]: [start, end] }
        }
      });

      data = {
        assigned_merchants: { count: assignedMerchantCount },
        pos_machines: {
          assigned_to_franchise: posMachineCount,
          assigned_to_merchants: merchantAssignedPosMachineCount
        },
        pos_transactions: {
          total: posStats.total,
          success: posStats.success,
          fail: posStats.fail,
          count: posStats.count,
          success_rate: posStats.success_rate,
          failure_rate: posStats.failure_rate
        },
        today_total_payout: Number(today_total_payout || 0)
      };
    }

    if (role === 'merchant') {
      const machines = await PosMachine.findAll({
        where: { assigned_to: userId },
        attributes: ['mid_number'],
        raw: true
      });
      const mids = machines.map((machine) => machine.mid_number).filter(Boolean);

      const merchantRoleFilter = {
        [Op.or]: [
          { user_id: userId },
          ...(mids.length ? [{ mid: { [Op.in]: mids } }] : [])
        ]
      };

      const [posMachineCount, posStats] = await Promise.all([
        PosMachine.count({ where: { assigned_to: userId } }),
        getRazorpayTransactionStats({ [Op.and]: [dateWhere, merchantRoleFilter] })
      ]);

      const today_total_payout = await WalletTransaction.sum('amount', {
        where: {
          requested_by: req.user.id,
          status: 'completed',
          type: { [Op.in]: ['transfer', 'hold'] },
          createdAt: { [Op.between]: [start, end] }
        }
      });

      data = {
        pos_machines: { count: posMachineCount },
        pos_transactions: {
          total: posStats.total,
          success: posStats.success,
          fail: posStats.fail,
          count: posStats.count,
          success_rate: posStats.success_rate,
          failure_rate: posStats.failure_rate
        },
        today_total_payout: Number(today_total_payout || 0)
      };
    }

    res.status(200).json({ message: 'Dashboard fetched', data });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

const normalizeDate = (dateStr, isEnd = false) => {
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return isEnd
    ? new Date(d.setHours(23, 59, 59, 999))
    : new Date(d.setHours(0, 0, 0, 0));
};

const getTodayPayoutList = asyncHandler(async (req, res) => {
  const { role, id: userId } = req.user;
  const { date, startDate, endDate } = req.query;

  let start, end;

  if (date) {
    start = normalizeDate(date);
    end = normalizeDate(date, true);
  } else if (startDate || endDate) {
    start = normalizeDate(startDate);
    end = normalizeDate(endDate, true);
  } else {
    ({ start, end } = getTodayRange());
  }

  if (!start || !end) {
    return res.status(400).json({ message: "Invalid date format" });
  }

  const where = {
    status: "completed",
    type: { [Op.in]: ["transfer", "unhold"] },
    createdAt: { [Op.between]: [start, end] }
  };

  if (role === "franchaise") {
    const merchants = await User.findAll({
      where: { franchaise_id: userId },
      attributes: ["id"],
    });
    const merchantIds = merchants.map((u) => u.id);
    where.requested_by = { [Op.in]: [...merchantIds, userId] };
  } else if (role === "merchant") {
    where.requested_by = userId;
  }

  const payouts = await WalletTransaction.findAll({
    where,
    order: [["createdAt", "DESC"]],
  });

  res.status(200).json({
    count: payouts.length,
    message: "Payout list fetched successfully.",
    date_range: { start, end },
    data: payouts,
  });
});

module.exports = {getDashboard, getTodayPayoutList}


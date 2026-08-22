const asyncHandler = require("express-async-handler");
const { Op } = require('sequelize');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const RazorpayNotification = require('../models/RazorpayNotification');
const CcBillPayment = require('../models/CcBillPayment');
const PayoutTransaction = require('../models/PayoutTransaction');
const PayoutRequest = require('../models/PayoutRequest');
const WalletTransaction = require("../models/WalletTransaction");
const BillAvenuePayment = require('../models/BillAvenuePayment');

const CC_BILL_SUCCESS_STATUS_CODES = ['TXN', 'TUP'];
const CC_BILL_FAILURE_STATUSES = ['FAILED', 'FAILURE', 'REJECTED', 'CANCELLED', 'REVERSED'];
const PAYOUT_FAILED_STATUSES = ['FAILED', 'FAILURE', 'REJECTED', 'CANCELLED', 'REVERSED'];


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

const toUniqueValues = (values = []) => [...new Set(values.filter((value) => value !== null && value !== undefined))];

const buildUserScopeFilter = (field, userIds = []) => {
  const scopedUserIds = toUniqueValues(userIds);
  if (!scopedUserIds.length) return null;

  return scopedUserIds.length === 1
    ? { [field]: scopedUserIds[0] }
    : { [field]: { [Op.in]: scopedUserIds } };
};

const getAssignedMachineMids = async (assigneeIds = []) => {
  const scopedAssigneeIds = toUniqueValues(assigneeIds);
  if (!scopedAssigneeIds.length) return [];

  const assignedToFilter = scopedAssigneeIds.length === 1
    ? scopedAssigneeIds[0]
    : { [Op.in]: scopedAssigneeIds };

  const machines = await PosMachine.findAll({
    where: { assigned_to: assignedToFilter },
    attributes: ['mid_number'],
    raw: true
  });

  return toUniqueValues(machines.map((machine) => machine.mid_number));
};

const getRazorpayTransactionStats = async (whereClause) => {
  if (!whereClause) {
    return { total: 0, success: 0, fail: 0, t0_amount: 0, t1_amount: 0, count: 0, success_rate: 0, failure_rate: 0 };
  }

  const [count, totalRaw, successRaw, failRaw, t0Raw, t1Raw] = await Promise.all([
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
    }),
    RazorpayNotification.sum('amount', {
      where: {
        ...whereClause,
        settlement_type: 'today_settlement',
        status: { [Op.in]: ['CAPTURED', 'AUTHORIZED', 'SETTLED'] }
      }
    }),
    RazorpayNotification.sum('amount', {
      where: {
        ...whereClause,
        settlement_type: 'next_day_settlement',
        status: { [Op.in]: ['CAPTURED', 'AUTHORIZED', 'SETTLED'] }
      }
    })
  ]);

  const total = Number(totalRaw || 0);
  const success = Number(successRaw || 0);
  const fail = Number(failRaw || 0);
  const t0_amount = Number(t0Raw || 0);
  const t1_amount = Number(t1Raw || 0);
  const countVal = Number(count || 0);

  return {
    total,
    success,
    fail,
    t0_amount,
    t1_amount,
    count: countVal,
    success_rate: total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0,
    failure_rate: total > 0 ? Number(((fail / total) * 100).toFixed(2)) : 0
  };
};

const getCcBillTransactionStats = async (whereClause) => {
  if (!whereClause) {
    return { total: 0, success: 0, fail: 0 };
  }

  const [totalRaw, successRaw, failRaw] = await Promise.all([
    CcBillPayment.sum('transaction_amount', { where: whereClause }),
    CcBillPayment.sum('transaction_amount', {
      where: {
        [Op.and]: [
          whereClause,
          { statuscode: { [Op.in]: CC_BILL_SUCCESS_STATUS_CODES } }
        ]
      }
    }),
    CcBillPayment.sum('transaction_amount', {
      where: {
        [Op.and]: [
          whereClause,
          {
            [Op.or]: [
              { statuscode: { [Op.notIn]: CC_BILL_SUCCESS_STATUS_CODES, [Op.not]: null } },
              { status: { [Op.in]: CC_BILL_FAILURE_STATUSES } }
            ]
          }
        ]
      }
    })
  ]);

  return {
    total: Number(totalRaw || 0),
    success: Number(successRaw || 0),
    fail: Number(failRaw || 0)
  };
};

const getBillAvenueCcBillTransactionStats = async (whereClause) => {
  if (!whereClause) {
    return { total: 0, success: 0, fail: 0 };
  }

  const [totalRaw, successRaw, failRaw] = await Promise.all([
    BillAvenuePayment.sum('transaction_amount', { where: whereClause }),
    BillAvenuePayment.sum('transaction_amount', {
      where: {
        ...whereClause,
        status: { [Op.in]: ['success', 'SUCCESS'] }
      }
    }),
    BillAvenuePayment.sum('transaction_amount', {
      where: {
        ...whereClause,
        status: { [Op.in]: ['failed', 'FAILED'] }
      }
    })
  ]);

  return {
    total: Number(totalRaw || 0),
    success: Number(successRaw || 0),
    fail: Number(failRaw || 0)
  };
};

const getPayoutStats = async ({ userIds = [], start, end }) => {
  const payoutTransactionWhere = {
    createdAt: { [Op.between]: [start, end] },
    status: { [Op.notIn]: PAYOUT_FAILED_STATUSES }
  };
  const payoutRequestWhere = {
    created_at: { [Op.between]: [start, end] },
    response_status: { [Op.notIn]: PAYOUT_FAILED_STATUSES }
  };

  const payoutTransactionScope = buildUserScopeFilter('merchant_id', userIds);
  const payoutRequestScope = buildUserScopeFilter('user_id', userIds);

  if (payoutTransactionScope) {
    Object.assign(payoutTransactionWhere, payoutTransactionScope);
  }

  if (payoutRequestScope) {
    Object.assign(payoutRequestWhere, payoutRequestScope);
  }

  const [payoutTransactionTotalRaw, payoutRequestTotalRaw] = await Promise.all([
    PayoutTransaction.sum('amount', { where: payoutTransactionWhere }),
    PayoutRequest.sum('amount', { where: payoutRequestWhere })
  ]);

  return Number(payoutTransactionTotalRaw || 0) + Number(payoutRequestTotalRaw || 0);
};

const getDashboard = asyncHandler(async (req, res) => {
  const role = req.user.role;
  const userId = req.user.id;
  const { start, end } = getTodayRange();

  try {
    let data = {};

    const dateWhere = {
      ...buildRazorpayDateRange(start, end),
      processing_status: 'completed'
    };

    const requesterRole = req.user?.original_role || req.user?.role;
    const isEmployeeUser = requesterRole && String(requesterRole).toLowerCase() === 'employee';

    if (role === 'admin' || isEmployeeUser) {
      const [activeMachineCount, deactiveMachineCount, activeMerchantCount, activeFranchaiseCount] =
        await Promise.all([
          PosMachine.count({ where: { status: { [Op.ne]: 'in_active' } } }),
          PosMachine.count({ where: { status: 'in_active' } }),
          User.count({ where: { role: 'merchant', status: 'active' } }),
          User.count({ where: { role: 'franchaise', status: 'active' } })
        ]);

      const [posStats, ccBillStats, baCcBillStats, today_total_payout] = await Promise.all([
        getRazorpayTransactionStats(dateWhere),
        getCcBillTransactionStats({ createdAt: { [Op.between]: [start, end] } }),
        getBillAvenueCcBillTransactionStats({ createdAt: { [Op.between]: [start, end] } }),
        getPayoutStats({ start, end })
      ]);

      data = {
        pos_machines: { active: activeMachineCount, inactive: deactiveMachineCount },
        merchants: { count: activeMerchantCount },
        franchaises: { count: activeFranchaiseCount },
        pos_transactions: {
          total: posStats.total,
          success: posStats.success,
          fail: posStats.fail,
          t0_amount: posStats.t0_amount,
          t1_amount: posStats.t1_amount,
          count: posStats.count,
          success_rate: posStats.success_rate,
          failure_rate: posStats.failure_rate
        },
        today_total_payout: Number(today_total_payout || 0),
        ccBillPaymentTXN: ccBillStats.total + baCcBillStats.total,
        ccBillPaymentSuccess: ccBillStats.success + baCcBillStats.success,
        ccBillPaymentFailed: ccBillStats.fail + baCcBillStats.fail
      };
    }

    if (role === 'franchaise') {
      const franchiseMerchantIds = await User.findAll({
        where: { franchaise_id: userId, role: 'merchant', status: 'active' },
        attributes: ['id'],
        raw: true
      }).then((rows) => rows.map((r) => r.id));

      const scopedUserIds = toUniqueValues([userId, ...franchiseMerchantIds]);

      const [assignedMerchantCount, posMachineCount, merchantAssignedPosMachineCount, scopedMids] = await Promise.all([
        User.count({ where: { franchaise_id: userId, role: 'merchant', status: 'active' } }),
        PosMachine.count({ where: { assigned_to: userId } }),
        franchiseMerchantIds.length > 0
          ? PosMachine.count({ where: { assigned_to: { [Op.in]: franchiseMerchantIds } } })
          : 0,
        getAssignedMachineMids(scopedUserIds)
      ]);

      const franchiseRoleFilter = (scopedUserIds.length > 0 || scopedMids.length > 0)
        ? {
          [Op.or]: [
            ...(scopedUserIds.length ? [{ user_id: { [Op.in]: scopedUserIds } }] : []),
            ...(scopedMids.length ? [{ mid: { [Op.in]: scopedMids } }] : [])
          ]
        }
        : { user_id: -1 };

      const ccBillWhere = {
        createdAt: { [Op.between]: [start, end] },
        user_id: { [Op.in]: scopedUserIds }
      };

      const [posStats, ccBillStats, baCcBillStats, today_total_payout] = await Promise.all([
        getRazorpayTransactionStats({ [Op.and]: [dateWhere, franchiseRoleFilter] }),
        getCcBillTransactionStats(ccBillWhere),
        getBillAvenueCcBillTransactionStats(ccBillWhere),
        getPayoutStats({ userIds: scopedUserIds, start, end })
      ]);

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
          t0_amount: posStats.t0_amount,
          t1_amount: posStats.t1_amount,
          count: posStats.count,
          success_rate: posStats.success_rate,
          failure_rate: posStats.failure_rate
        },
        today_total_payout: Number(today_total_payout || 0),
        ccBillPaymentTXN: ccBillStats.total + baCcBillStats.total,
        ccBillPaymentSuccess: ccBillStats.success + baCcBillStats.success,
        ccBillPaymentFailed: ccBillStats.fail + baCcBillStats.fail
      };
    }

    if (role === 'merchant') {
      const mids = await getAssignedMachineMids([userId]);

      const merchantRoleFilter = {
        [Op.or]: [
          { user_id: userId },
          ...(mids.length ? [{ mid: { [Op.in]: mids } }] : [])
        ]
      };

      const ccBillWhere = {
        createdAt: { [Op.between]: [start, end] },
        user_id: userId
      };

      const [posMachineCount, posStats, ccBillStats, baCcBillStats, today_total_payout] = await Promise.all([
        PosMachine.count({ where: { assigned_to: userId } }),
        getRazorpayTransactionStats({ [Op.and]: [dateWhere, merchantRoleFilter] }),
        getCcBillTransactionStats(ccBillWhere),
        getBillAvenueCcBillTransactionStats(ccBillWhere),
        getPayoutStats({ userIds: [userId], start, end })
      ]);

      data = {
        pos_machines: { count: posMachineCount },
        pos_transactions: {
          total: posStats.total,
          success: posStats.success,
          fail: posStats.fail,
          t0_amount: posStats.t0_amount,
          t1_amount: posStats.t1_amount,
          count: posStats.count,
          success_rate: posStats.success_rate,
          failure_rate: posStats.failure_rate
        },
        today_total_payout: Number(today_total_payout || 0),
        ccBillPaymentTXN: ccBillStats.total + baCcBillStats.total,
        ccBillPaymentSuccess: ccBillStats.success + baCcBillStats.success,
        ccBillPaymentFailed: ccBillStats.fail + baCcBillStats.fail
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


const asyncHandler = require("express-async-handler");
const { Op } = require('sequelize');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const Transaction = require("../models/Transaction");
const WalletTransaction = require("../models/WalletTransaction");


const getTodayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const getDashboard = asyncHandler(async (req, res) => {
  const role = req.user.role;
  const userId = req.user.id;
  const { start, end } = getTodayRange();

  try {
    let data = {};

    if (role === "admin") {
      const [activeMachineCount, deactiveMachineCount, activeMerchantCount, activeFranchaiseCount] =
        await Promise.all([
          PosMachine.count({ where: { status: { [Op.ne]: 'in_active' } } }),
          PosMachine.count({ where: { status: 'in_active' } }),
          User.count({ where: { role: "merchant", status: 'active' } }),
          User.count({ where: { role: "franchaise", status: 'active' } }),
        ]);

      const [total, success, fail] = await Promise.all([
        Transaction.sum('Amount', { where: { createdAt: { [Op.between]: [start, end] } } }),
        Transaction.sum('Amount', {
          where: { Status: "SETTLED", createdAt: { [Op.between]: [start, end] } }
        }),
        Transaction.sum('Amount', {
          where: { Status: "FAILED", createdAt: { [Op.between]: [start, end] } }
        })
      ]);

      const today_total_payout = await WalletTransaction.sum('amount', { where: { status: "completed", type:{ [Op.in]: ["transfer", "unhold"]}, createdAt: { [Op.between]: [start, end] } } });

      data = {
        pos_machines: { active: activeMachineCount, inactive: deactiveMachineCount },
        merchants: { count: activeMerchantCount },
        franchaises: { count: activeFranchaiseCount },
        pos_transactions: { total, success, fail },
        today_total_payout: today_total_payout || 0
      };
    }

    if (role === "franchaise") {
    const machines = await PosMachine.findAll({
        where: { franchaise_id: userId },
        attributes: ['mid_number'],
        raw: true
    });
    const mids = machines.map(machine => machine.mid_number).filter(Boolean); // removes nulls if any

      const [assignedMerchantCount, posMachineCount] = await Promise.all([
        User.count({ where: { franchaise_id: userId, role: "merchant", status: "active" } }),
        PosMachine.count({ where: { franchaise_id: userId } })
      ]);

      const [total, success, fail] = await Promise.all([
        Transaction.sum('Amount', {
          where: {
            createdAt: { [Op.between]: [start, end] },
            MID: { [Op.in]: mids} // Use your actual field if it's different
          }
        }),
        Transaction.sum('Amount', {
          where: {
            Status: "SETTLED",
            createdAt: { [Op.between]: [start, end] },
            MID: { [Op.in]: mids}
          }
        }),
        Transaction.sum('Amount', {
          where: {
            Status: "FAILED",
            createdAt: { [Op.between]: [start, end] },
            MID: { [Op.in]: mids}
          }
        })
      ]);

      const today_total_payout = await WalletTransaction.sum('amount', { where: { requested_by: req.user.id, status: "completed", type:{ [Op.in]: ["transfer", "hold"]}, createdAt: { [Op.between]: [start, end] } } });

      data = {
        assigned_merchants: { count: assignedMerchantCount },
        pos_machines: { count: posMachineCount },
        pos_transactions: { total, success, fail },
        today_total_payout: today_total_payout

      };
    }

    if (role === "merchant") {
      const machines = await PosMachine.findAll({
        where: { assigned_user_id: userId },
        attributes: ['mid_number'],
        raw: true
        });
      const mids = machines.map(machine => machine.mid_number).filter(Boolean); 
      const [total, success, fail] = await Promise.all([
        Transaction.sum('Amount', {
          where: {
            createdAt: { [Op.between]: [start, end] },
            MID: mids?.map(val => '${val}').join(', ')
          }
        }),
        Transaction.sum('Amount', {
          where: {
            Status: "SETTLED",
            createdAt: { [Op.between]: [start, end] },
            MID: mids?.map(val => '${val}').join(', ')
          }
        }),
        Transaction.sum('Amount', {
          where: {
            Status: "FAILED",
            createdAt: { [Op.between]: [start, end] },
            MID: mids?.map(val => '${val}').join(', ')
          }
        })
      ]);

      const today_total_payout = await WalletTransaction.sum('amount', { where: { requested_by: req.user.id, status: "completed", type:{ [Op.in]: ["transfer", "hold"]}, createdAt: { [Op.between]: [start, end] } } });

      data = {
        pos_transactions: { total, success, fail },
        today_total_payout: today_total_payout
      };
    }

    res.status(200).json({ message: "Dashboard fetched", data });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
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


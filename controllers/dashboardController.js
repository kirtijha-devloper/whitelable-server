const asyncHandler = require("express-async-handler");
const { Op } = require('sequelize');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const Transaction = require("../models/Transaction")


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

      data = {
        pos_machines: { active: activeMachineCount, inactive: deactiveMachineCount },
        merchants: { count: activeMerchantCount },
        franchaises: { count: activeFranchaiseCount },
        pos_transactions: { total, success, fail }
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

      data = {
        assigned_merchants: { count: assignedMerchantCount },
        pos_machines: { count: posMachineCount },
        pos_transactions: { total, success, fail }
      };
    }

    if (role === "merchant") {
      const [total, success, fail] = await Promise.all([
        Transaction.sum('Amount', {
          where: {
            createdAt: { [Op.between]: [start, end] },
            MID: req.user.mid_number
          }
        }),
        Transaction.sum('Amount', {
          where: {
            Status: "SETTLED",
            createdAt: { [Op.between]: [start, end] },
            MID: req.user.mid_number
          }
        }),
        Transaction.sum('Amount', {
          where: {
            Status: "FAILED",
            createdAt: { [Op.between]: [start, end] },
            MID: req.user.mid_number
          }
        })
      ]);

      data = {
        pos_transactions: { total, success, fail }
      };
    }

    res.status(200).json({ message: "Dashboard fetched", data });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});
    


module.exports = {getDashboard}


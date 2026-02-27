const asyncHandler = require("express-async-handler");
const { Op } = require('sequelize');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');



const getTodayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const getAdminDashboard = asyncHandler( async (req, res) => {
    const { start, end } = getTodayRange();
  try {
      const activeMachineCount = await PosMachine.count({ where: { status: 'active' } });
      const deactiveMachineCount = await PosMachine.count({ where: { status: 'in_active' } });
      const activeMerchantCount = await User.count({ where: { role: "merchant", status: 'active' } });
      const activeFranchaiseCount = await User.count({ where: { role: "franchaise", status: 'active' } });
      
      // const todayPosTransactions = await Transaction.sum('amount', {
      //     where: {
      //     type: 'POS',
      //     createdAt: { [Op.between]: [start, end] },
      //     },
      // });
      
      res.status(200).json({
        message: 'Admin Dashboard Data Fetched Successfully',
        data: {
          posMachines: {
            active: activeMachineCount,
            inactive: deactiveMachineCount,
          },
          merchants: {
            count: activeMerchantCount
          },
          franchaises: {
            count:activeFranchaiseCount
          }}
  });
  } catch (error) {
      console.error('Error fetching admin dashboard data:', error);
      res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
    }
});


    


/**
 * GET /api/admin/merchants/unassigned
 *
 * Returns the list of merchant-role users that have no franchise above them
 * (franchaise_id IS NULL).  Admin-only.
 *
 * Query params (all optional):
 *   page     {number}  Page number, default 1
 *   limit    {number}  Records per page, default 20, max 100
 *   status   {string}  Filter by account status (active / inactive / etc.)
 *   search   {string}  Partial match on name, email, or mobile_number
 */
const getUnassignedMerchants = asyncHandler(async (req, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access only." });
  }

  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const where = {
    role:          "merchant",
    franchaise_id: null,
  };

  if (req.query.status) {
    where.status = req.query.status;
  }

  if (req.query.search) {
    const term = `%${req.query.search}%`;
    where[Op.or] = [
      { name:          { [Op.like]: term } },
      { email:         { [Op.like]: term } },
      { mobile_number: { [Op.like]: term } },
    ];
  }

  const { count, rows } = await User.findAndCountAll({
    where,
    attributes: [
      "id", "name", "email", "mobile_number", "organization_name",
      "status", "wallet", "is_approved", "is_pos_asigned",
      "abheepay_id", "createdAt",
    ],
    order:  [["createdAt", "DESC"]],
    limit,
    offset,
  });

  return res.status(200).json({
    success: true,
    message: "Unassigned merchants fetched successfully.",
    data: {
      total:       count,
      page,
      limit,
      totalPages:  Math.ceil(count / limit),
      merchants:   rows,
    },
  });
});

module.exports = { getAdminDashboard, getUnassignedMerchants };


const asyncHandler = require("express-async-handler");
const { Op } = require('sequelize');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const ServiceToggleAuditLog = require('../models/ServiceToggleAuditLog');

function maskMobileNumber(mobile) {
  if (!mobile) return "";
  const str = String(mobile).trim();
  if (str.length <= 4) return str;
  return "*".repeat(str.length - 4) + str.slice(-4);
}

function extractClientIp(req) {
  if (!req) return '127.0.0.1';
  const forwarded = req.headers
    ? (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['cf-connecting-ip'])
    : null;
  if (forwarded) {
    const rawIp = String(forwarded).split(',')[0].trim();
    const cleanIp = rawIp.startsWith('::ffff:') ? rawIp.replace('::ffff:', '') : rawIp;
    if (cleanIp && cleanIp !== '::1' && cleanIp !== '127.0.0.1') {
      return cleanIp;
    }
  }

  let fallbackIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || null;
  if (fallbackIp) {
    if (fallbackIp.startsWith('::ffff:')) {
      fallbackIp = fallbackIp.replace('::ffff:', '');
    }
    if (fallbackIp === '::1') {
      fallbackIp = '127.0.0.1';
    }
    return fallbackIp;
  }

  return '127.0.0.1';
}



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

  let resultRows = rows;
  const requesterRole = req.user?.original_role || req.user?.role;
  if (requesterRole && String(requesterRole).toLowerCase() === 'employee') {
    resultRows = rows.map(r => {
      const plain = r.toJSON ? r.toJSON() : { ...r };
      plain.mobile_number = maskMobileNumber(plain.mobile_number);
      return plain;
    });
  }

  return res.status(200).json({
    success: true,
    message: "Unassigned merchants fetched successfully.",
    data: {
      total:       count,
      page,
      limit,
      totalPages:  Math.ceil(count / limit),
      merchants:   resultRows,
    },
  });
});

const setUserIpayOutletId = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only.' });
  }

  const { id } = req.params;
  const { ipay_outlet_id } = req.body;

  if (ipay_outlet_id === undefined) {
    res.status(400);
    throw new Error('ipay_outlet_id is required');
  }

  let parsed = null;
  if (ipay_outlet_id !== null) {
    parsed = parseInt(ipay_outlet_id, 10);
    if (isNaN(parsed)) {
      res.status(400);
      throw new Error('ipay_outlet_id must be a valid integer or null');
    }
  }

  const user = await User.findByPk(id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  user.ipay_outlet_id = parsed;
  await user.save();

  return res.status(200).json({
    success: true,
    message: 'InstantPay outlet ID updated successfully',
    data: {
      id: user.id,
      ipay_outlet_id: user.ipay_outlet_id,
    },
  });
});

const setUserSettlementType = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only.' });
  }

  const { id } = req.params;
  const { settlement_type } = req.body;
  const supportedTypes = ['today_settlement', 'next_day_settlement'];

  if (!settlement_type || typeof settlement_type !== 'string') {
    res.status(400);
    throw new Error('settlement_type is required and must be a string');
  }

  if (!supportedTypes.includes(settlement_type)) {
    res.status(400);
    throw new Error('settlement_type must be either "today_settlement" or "next_day_settlement"');
  }

  const user = await User.findByPk(id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  if (!['merchant', 'franchaise'].includes(user.role)) {
    res.status(400);
    throw new Error('Settlement type can only be updated for merchant or franchise users');
  }

  const prevSettlementType = user.settlement_type || 'today_settlement';

  user.settlement_type = settlement_type;
  await user.save();

  if (prevSettlementType !== settlement_type) {
    const isTodayNew = settlement_type === 'today_settlement';
    const isTodayPrev = prevSettlementType === 'today_settlement';

    await ServiceToggleAuditLog.create({
      user_id: req.user.id,
      affected_user_id: user.id,
      service_key: 'settlement_type',
      previous_state: isTodayPrev,
      new_state: isTodayNew,
      action: isTodayNew ? 'T0' : 'T+1',
      ip_address: extractClientIp(req),
      user_agent: req.headers ? (req.headers['user-agent'] || null) : null,
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Settlement type updated successfully',
    data: {
      id: user.id,
      role: user.role,
      settlement_type: user.settlement_type,
    },
  });
});

const setAllUsersSettlementType = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only.' });
  }

  const { settlement_type } = req.body;
  const supportedTypes = ['today_settlement', 'next_day_settlement'];

  if (!settlement_type || typeof settlement_type !== 'string') {
    res.status(400);
    throw new Error('settlement_type is required and must be a string');
  }

  if (!supportedTypes.includes(settlement_type)) {
    res.status(400);
    throw new Error('settlement_type must be either "today_settlement" or "next_day_settlement"');
  }

  const [updatedCount] = await User.update(
    { settlement_type },
    {
      where: {
        role: {
          [Op.in]: ['merchant', 'franchaise'],
        },
      },
    }
  );

  const isTodayNew = settlement_type === 'today_settlement';
  await ServiceToggleAuditLog.create({
    user_id: req.user.id,
    affected_user_id: null,
    service_key: 'settlement_type',
    previous_state: !isTodayNew,
    new_state: isTodayNew,
    action: isTodayNew ? 'T0' : 'T+1',
    ip_address: extractClientIp(req),
    user_agent: req.headers ? (req.headers['user-agent'] || null) : null,
  });

  return res.status(200).json({
    success: true,
    message: `Settlement type updated to '${settlement_type}' for ${updatedCount} merchant/franchise users.`,
    data: {
      settlement_type,
      updatedCount,
    },
  });
});

module.exports = { getAdminDashboard, getUnassignedMerchants, setUserIpayOutletId, setUserSettlementType, setAllUsersSettlementType };


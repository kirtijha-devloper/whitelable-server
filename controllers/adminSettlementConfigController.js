const { Op } = require('sequelize');
const db = require('../config/database');
const SystemSettlementConfig = require('../models/SystemSettlementConfig');
const SettlementAuditLog = require('../models/SettlementAuditLog');
const User = require('../models/User');

/**
 * Helper to ensure a global config record exists (ID 1)
 */
async function getOrCreateGlobalConfig(transaction = null) {
  let config = await SystemSettlementConfig.findOne({ where: { id: 1 }, transaction });
  if (!config) {
    config = await SystemSettlementConfig.create({
      id: 1,
      global_cutoff_enabled: true,
      global_default_cutoff_time: '10:00',
      auto_settlement_time: '10:00',
    }, { transaction });
  }
  return config;
}

/**
 * GET /api/admin/settlement/config
 * Fetches global cutoff toggle state & default cutoff time
 */
async function getGlobalSettlementConfig(req, res) {
  try {
    const config = await getOrCreateGlobalConfig();
    return res.status(200).json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('Error in getGlobalSettlementConfig:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch global settlement config.',
      error: error.message,
    });
  }
}

/**
 * PUT /api/admin/settlement/config
 * Updates global cutoff toggle state or default time, and logs audit record
 */
async function updateGlobalSettlementConfig(req, res) {
  const transaction = await db.transaction();
  try {
    const { global_cutoff_enabled, global_default_cutoff_time, auto_settlement_time } = req.body;
    const config = await getOrCreateGlobalConfig(transaction);

    const prevState = {
      global_cutoff_enabled: config.global_cutoff_enabled,
      global_default_cutoff_time: config.global_default_cutoff_time,
      auto_settlement_time: config.auto_settlement_time,
    };

    if (global_cutoff_enabled !== undefined) {
      config.global_cutoff_enabled = Boolean(global_cutoff_enabled);
    }
    if (global_default_cutoff_time !== undefined && global_default_cutoff_time !== null) {
      config.global_default_cutoff_time = String(global_default_cutoff_time).trim();
    }
    if (auto_settlement_time !== undefined && auto_settlement_time !== null) {
      config.auto_settlement_time = String(auto_settlement_time).trim();
    }

    await config.save({ transaction });

    const newState = {
      global_cutoff_enabled: config.global_cutoff_enabled,
      global_default_cutoff_time: config.global_default_cutoff_time,
      auto_settlement_time: config.auto_settlement_time,
    };

    let action = 'UPDATE_GLOBAL_SETTLEMENT_CONFIG';
    if (prevState.global_cutoff_enabled !== newState.global_cutoff_enabled) {
      action = 'TOGGLE_GLOBAL_CUTOFF';
    }

    await SettlementAuditLog.create({
      performing_user_id: req.user ? req.user.id : null,
      affected_user_id: null,
      action,
      previous_state: JSON.stringify(prevState),
      new_state: JSON.stringify(newState),
    }, { transaction });

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: 'Global settlement config updated successfully.',
      data: config,
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error in updateGlobalSettlementConfig:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update global settlement config.',
      error: error.message,
    });
  }
}

/**
 * GET /api/admin/settlement/users
 * Fetches user list with T0 balance (wallet), T1 balance, opening balance (prev_day_settled_balance), and custom cutoff time
 */
async function getSettlementUsers(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;
    const { search, role } = req.query;

    const where = {};
    if (role) {
      where.role = role;
    }
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile_number: { [Op.iLike]: `%${search}%` } },
        { abheepay_id: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows: users } = await User.findAndCountAll({
      where,
      attributes: [
        'id',
        'name',
        'email',
        'mobile_number',
        'role',
        'abheepay_id',
        'wallet',
        't1_balance',
        'prev_day_settled_balance',
        'cutoff_timestamp',
        'settlement_type',
        'status',
      ],
      limit,
      offset,
      order: [['id', 'DESC']],
    });

    const globalConfig = await getOrCreateGlobalConfig();

    const formattedUsers = users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      mobile_number: u.mobile_number,
      role: u.role,
      abheepay_id: u.abheepay_id,
      wallet: parseFloat(u.wallet) || 0,
      t0_balance: parseFloat(u.wallet) || 0,
      t1_balance: parseFloat(u.t1_balance) || 0,
      prev_day_settled_balance: parseFloat(u.prev_day_settled_balance) || 0,
      cutoff_timestamp: u.cutoff_timestamp,
      effective_cutoff_time: u.cutoff_timestamp || globalConfig.global_default_cutoff_time,
      settlement_type: u.settlement_type,
      status: u.status,
    }));

    return res.status(200).json({
      success: true,
      data: formattedUsers,
      meta: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('Error in getSettlementUsers:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch settlement users.',
      error: error.message,
    });
  }
}

/**
 * PUT /api/admin/settlement/users/:id/cutoff
 * Updates an individual user's custom cutoff timestamp (cutoff_timestamp)
 */
async function updateUserCutoff(req, res) {
  const transaction = await db.transaction();
  try {
    const userId = req.params.id;
    const { cutoff_timestamp } = req.body;

    const user = await User.findByPk(userId, { transaction });
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const previousCutoff = user.cutoff_timestamp;
    const newCutoff = cutoff_timestamp ? String(cutoff_timestamp).trim() : null;

    user.cutoff_timestamp = newCutoff;
    await user.save({ transaction });

    await SettlementAuditLog.create({
      performing_user_id: req.user ? req.user.id : null,
      affected_user_id: user.id,
      action: 'UPDATE_CUTOFF_TIMESTAMP',
      previous_state: JSON.stringify({ cutoff_timestamp: previousCutoff }),
      new_state: JSON.stringify({ cutoff_timestamp: newCutoff }),
    }, { transaction });

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: 'User cutoff timestamp updated successfully.',
      data: {
        id: user.id,
        cutoff_timestamp: user.cutoff_timestamp,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error in updateUserCutoff:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update user cutoff timestamp.',
      error: error.message,
    });
  }
}

/**
 * POST /api/admin/settlement/users/:id/trigger-settlement
 * Manually triggers immediate T1 -> T0 / Prev Day Settled balance settlement for a user
 */
async function triggerUserSettlement(req, res) {
  const transaction = await db.transaction();
  try {
    const userId = req.params.id;
    const user = await User.findByPk(userId, { transaction });

    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const t1Amt = parseFloat(user.t1_balance) || 0;
    const oldOpening = parseFloat(user.prev_day_settled_balance) || 0;

    if (t1Amt <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'User has no pending T1 balance to settle.',
      });
    }

    const newOpening = oldOpening + t1Amt;

    user.prev_day_settled_balance = newOpening;
    user.t1_balance = 0.00;
    await user.save({ transaction });

    await SettlementAuditLog.create({
      performing_user_id: req.user ? req.user.id : null,
      affected_user_id: user.id,
      action: 'T1_TO_T0_SETTLEMENT',
      previous_state: `T1: ₹${t1Amt.toFixed(2)}, Opening: ₹${oldOpening.toFixed(2)}`,
      new_state: `T1: ₹0.00, Opening: ₹${newOpening.toFixed(2)}`,
    }, { transaction });

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: `Successfully settled ₹${t1Amt.toFixed(2)} from T1 to usable balance for user #${user.id}.`,
      data: {
        userId: user.id,
        t1_balance: user.t1_balance,
        prev_day_settled_balance: user.prev_day_settled_balance,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error in triggerUserSettlement:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to trigger settlement.',
      error: error.message,
    });
  }
}

/**
 * GET /api/admin/settlement/audit-logs
 * Returns paginated audit logs (with filters for search, date, action)
 */
async function getSettlementAuditLogs(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;
    const { action, startDate, endDate, search } = req.query;

    const where = {};
    if (action) {
      where.action = action;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        where.createdAt[Op.lte] = new Date(endDate);
      }
    }

    const include = [
      {
        model: User,
        as: 'performingUser',
        attributes: ['id', 'name', 'email', 'role', 'abheepay_id'],
        required: false,
      },
      {
        model: User,
        as: 'affectedUser',
        attributes: ['id', 'name', 'email', 'role', 'abheepay_id'],
        required: false,
      },
    ];

    if (search) {
      where[Op.or] = [
        { action: { [Op.iLike]: `%${search}%` } },
        { previous_state: { [Op.iLike]: `%${search}%` } },
        { new_state: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows: logs } = await SettlementAuditLog.findAndCountAll({
      where,
      include,
      limit,
      offset,
      order: [['createdAt', 'DESC']],
    });

    return res.status(200).json({
      success: true,
      data: logs,
      meta: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('Error in getSettlementAuditLogs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch settlement audit logs.',
      error: error.message,
    });
  }
}

module.exports = {
  getGlobalSettlementConfig,
  updateGlobalSettlementConfig,
  getSettlementUsers,
  updateUserCutoff,
  triggerUserSettlement,
  getSettlementAuditLogs,
  getOrCreateGlobalConfig,
};

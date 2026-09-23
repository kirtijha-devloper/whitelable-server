const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const User = require('../models/User');
const ServiceToggleAuditLog = require('../models/ServiceToggleAuditLog');
const { normalizeSettlementType, validateMerchantT0Limit } = require('../services/settlementService');
const { maskEmail } = require('../utils/masking');

/**
 * GET /api/admin/pos-setting
 * Returns list of merchants with settlement_type, t0_daily_limit, and summary statistics.
 */
const getPosSettings = asyncHandler(async (req, res) => {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'franchaise') {
    return res.status(403).json({ success: false, message: 'Admin or Franchise access only.' });
  }

  const where = {};
  if (role === 'franchaise') {
    where.franchaise_id = req.user.id;
    where.role = 'merchant';
  } else {
    where.role = { [Op.in]: ['merchant', 'franchaise'] };
  }

  const merchants = await User.findAll({
    where,
    attributes: [
      'id',
      'name',
      'email',
      'role',
      'status',
      'settlement_type',
      't0_daily_limit',
      'franchaise_id',
      'createdAt',
      'updatedAt'
    ],
    order: [['id', 'ASC']]
  });

  let t0ActiveCount = 0;
  let t1ActiveCount = 0;
  let t0LimitConfiguredCount = 0;

  const formattedMerchants = merchants.map((m) => {
    const plain = m.toJSON ? m.toJSON() : { ...m };
    const normalizedType = normalizeSettlementType(plain.settlement_type);

    if (plain.status === 'active') {
      if (normalizedType === 'T0') {
        t0ActiveCount += 1;
      } else {
        t1ActiveCount += 1;
      }
    }

    if (plain.t0_daily_limit !== null && plain.t0_daily_limit !== undefined) {
      t0LimitConfiguredCount += 1;
    }

    plain.settlement_type = normalizedType;
    plain.email = maskEmail(plain.email);
    return plain;
  });

  let franchisePool = null;
  if (role === 'franchaise') {
    const RazorpayNotification = require('../models/RazorpayNotification');
    const totalPool = parseFloat(req.user.t0_daily_limit) || 0;
    const allocatedToMerchants = merchants.reduce((sum, m) => {
      const l = parseFloat(m.t0_daily_limit);
      return sum + (isNaN(l) ? 0 : l);
    }, 0);

    const remainingSelfLimit = Math.max(0, totalPool - allocatedToMerchants);

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const usedRaw = await RazorpayNotification.sum('amount', {
      where: {
        user_id: req.user.id,
        status: { [Op.in]: ['CAPTURED', 'SUCCESS', 'AUTHORIZED'] },
        settlement_type: { [Op.in]: ['T0', 'today_settlement'] },
        createdAt: { [Op.between]: [startOfDay, endOfDay] }
      }
    });
    const usedToday = parseFloat(usedRaw) || 0;
    const leftToday = Math.max(0, remainingSelfLimit - usedToday);

    franchisePool = {
      total_pool: totalPool,
      allocated_to_merchants: allocatedToMerchants,
      remaining_self_limit: remainingSelfLimit,
      used_today: usedToday,
      left_today: leftToday,
    };
  }

  return res.status(200).json({
    success: true,
    message: 'POS settlement settings fetched successfully.',
    data: {
      summary: {
        t0_active_count: t0ActiveCount,
        t1_active_count: t1ActiveCount,
        t0_limit_configured_count: t0LimitConfiguredCount,
        total_merchants: merchants.length
      },
      ...(franchisePool ? { franchise_pool: franchisePool } : {}),
      merchants: formattedMerchants
    }
  });
});

/**
 * POST /api/admin/pos-setting/update-t0-limit
 * Body: { id: 101, t0_daily_limit: 50000 | null }
 */
const updateT0Limit = asyncHandler(async (req, res) => {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'franchaise') {
    return res.status(403).json({ success: false, message: 'Admin or Franchise access only.' });
  }

  const { id, t0_daily_limit } = req.body;

  if (!id) {
    res.status(400);
    throw new Error('User id is required');
  }

  let limitVal = null;
  if (t0_daily_limit !== null && t0_daily_limit !== undefined && t0_daily_limit !== '') {
    limitVal = parseFloat(t0_daily_limit);
    if (isNaN(limitVal) || limitVal < 0) {
      res.status(400);
      throw new Error('t0_daily_limit must be a valid non-negative number or null');
    }
  }

  const user = await User.findByPk(id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  if (role === 'franchaise') {
    if (user.franchaise_id !== req.user.id) {
      res.status(403);
      throw new Error('You can only update T0 limits for merchants assigned to your franchise.');
    }
  }

  // Validate merchant limit against parent Franchise pool & current utilization
  await validateMerchantT0Limit({
    targetUser: user,
    requestedLimit: limitVal,
    requesterUser: req.user
  });

  user.t0_daily_limit = limitVal;
  await user.save();

  return res.status(200).json({
    success: true,
    message: 'T0 daily limit updated successfully',
    data: {
      id: user.id,
      t0_daily_limit: user.t0_daily_limit !== null ? String(user.t0_daily_limit) : null
    }
  });
});

/**
 * POST /api/admin/pos-setting/update-settlement-type
 * Body: { id: 101, settlement_type: 'T0' | 'T1' }
 */
const updateSettlementType = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only.' });
  }

  const { id, settlement_type } = req.body;

  if (!id) {
    res.status(400);
    throw new Error('User id is required');
  }

  if (!settlement_type || typeof settlement_type !== 'string') {
    res.status(400);
    throw new Error('settlement_type is required and must be a string');
  }

  const normalized = normalizeSettlementType(settlement_type);

  const user = await User.findByPk(id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  if (!['merchant', 'franchaise'].includes(user.role)) {
    res.status(400);
    throw new Error('Settlement type can only be updated for merchant or franchise users');
  }

  const prevType = user.settlement_type || 'T0';
  user.settlement_type = normalized;
  await user.save();

  if (normalizeSettlementType(prevType) !== normalized) {
    try {
      await ServiceToggleAuditLog.create({
        user_id: req.user.id,
        target_type: user.role === 'franchaise' ? 'franchise' : 'user',
        target_id: user.id,
        service_key: 'pos_t0_settlement',
        action: normalized === 'T0' ? 'ENABLE' : 'DISABLE',
        ip_address: req.ip || '127.0.0.1',
        user_agent: req.headers ? req.headers['user-agent'] : null,
      });
    } catch (_) {
      // Ignore audit log failure
    }
  }

  return res.status(200).json({
    success: true,
    message: 'Settlement type updated successfully',
    data: {
      id: user.id,
      settlement_type: user.settlement_type
    }
  });
});

/**
 * POST /api/admin/pos-setting/bulk-settlement
 * Body: { settlement_type: 'T0' | 'T1' }
 * Updates settlement_type for all merchant and franchise users in a single query.
 */
const bulkUpdateSettlementType = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only.' });
  }

  const { settlement_type } = req.body;

  if (!settlement_type || typeof settlement_type !== 'string') {
    res.status(400);
    throw new Error('settlement_type is required and must be a string');
  }

  const normalized = normalizeSettlementType(settlement_type);

  const [affectedRows] = await User.update(
    { settlement_type: normalized },
    {
      where: {
        role: { [Op.in]: ['merchant', 'franchaise'] }
      }
    }
  );

  return res.status(200).json({
    success: true,
    message: `Successfully updated settlement_type to ${normalized} for ${affectedRows} merchants.`,
    data: {
      settlement_type: normalized,
      updated_count: affectedRows
    }
  });
});

module.exports = {
  getPosSettings,
  updateT0Limit,
  updateSettlementType,
  bulkUpdateSettlementType,
};

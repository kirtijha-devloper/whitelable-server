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
  if (role !== 'admin' && role !== 'super_franchise' && role !== 'franchaise' && role !== 'franchise') {
    return res.status(403).json({ success: false, message: 'Admin, Super Franchise, or Franchise access only.' });
  }

  const serviceSettingsService = require('../services/serviceSettingsService');
  const isGlobalT0Enabled = await serviceSettingsService.getServiceFlagValue("pos_t0_settlement", true);
  const isUserDailyLimitEnabled = await serviceSettingsService.getServiceFlagValue("user_daily_limit", true);
  const isGlobalEnabled = isGlobalT0Enabled && isUserDailyLimitEnabled;

  const where = {};
  if (role === 'super_franchise') {
    where.super_franchise_id = req.user.id;
    where.role = { [Op.in]: ['merchant', 'franchaise', 'franchise'] };
  } else if (role === 'franchaise' || role === 'franchise') {
    where.franchaise_id = req.user.id;
    where.role = 'merchant';
  } else {
    where.role = { [Op.in]: ['merchant', 'user', 'franchaise', 'franchise', 'super_franchise'] };
  }

  const merchants = await User.findAll({
    where,
    attributes: [
      'id',
      'name',
      'username',
      'email',
      'mobile_number',
      'abheepay_id',
      'role',
      'status',
      'settlement_type',
      't0_daily_limit',
      'franchaise_id',
      'super_franchise_id',
      'createdAt',
      'updatedAt'
    ],
    order: req.user?.original_role === 'employee'
      ? [['createdAt', 'DESC']]
      : [['id', 'ASC']]
  });

  let t0ActiveCount = 0;
  let t1ActiveCount = 0;
  let t0LimitConfiguredCount = 0;

  const formattedCustomers = merchants.map((m) => {
    const plain = m.toJSON ? m.toJSON() : { ...m };
    const normalizedType = normalizeSettlementType(plain.settlement_type);

    if (plain.role !== 'super_franchise' && plain.status === 'active') {
      if (normalizedType === 'T0') {
        t0ActiveCount += 1;
      } else {
        t1ActiveCount += 1;
      }
    }

    if (plain.role !== 'super_franchise' && plain.t0_daily_limit !== null && plain.t0_daily_limit !== undefined) {
      t0LimitConfiguredCount += 1;
    }

    plain.settlement_type = normalizedType;
    plain.email = maskEmail(plain.email);
    return plain;
  });
  const formattedMerchants = formattedCustomers.filter((customer) =>
    ['merchant', 'franchaise', 'franchise'].includes(String(customer.role || '').toLowerCase())
  );
  const settlementMerchants = merchants.filter((merchant) => {
    const roleName = String(merchant.role || '').toLowerCase();
    return roleName !== 'super_franchise' && roleName !== 'superfranchise';
  });

  let franchisePool = null;
  if (role === 'franchaise') {
    const RazorpayNotification = require('../models/RazorpayNotification');
    const totalPool = parseFloat(req.user.t0_daily_limit) || 0;
    const allocatedToMerchants = settlementMerchants.reduce((sum, m) => {
      const l = parseFloat(m.t0_daily_limit);
      return sum + (isNaN(l) ? 0 : l);
    }, 0);

    const remainingSelfLimit = Math.max(0, totalPool - allocatedToMerchants);

    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const now = new Date();
    const istNow = new Date(now.getTime() + istOffsetMs);
    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const date = istNow.getUTCDate();

    const startOfDay = new Date(Date.UTC(year, month, date, 0, 0, 0, 0) - istOffsetMs);
    const endOfDay = new Date(Date.UTC(year, month, date, 23, 59, 59, 999) - istOffsetMs);

    const usedRaw = await RazorpayNotification.sum('amount', {
      where: {
        user_id: req.user.id,
        status: { [Op.in]: ['CAPTURED', 'SUCCESS', 'AUTHORIZED', 'captured', 'success', 'authorized'] },
        settlement_type: { [Op.in]: ['T0', 'today_settlement', 'TODAY_SETTLEMENT', 't0'] },
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
        total_merchants: formattedMerchants.length,
        total_customers: formattedCustomers.length,
        is_global_t0_enabled: isGlobalEnabled,
        is_pos_t0_settlement_enabled: isGlobalT0Enabled,
        is_user_daily_limit_enabled: isUserDailyLimitEnabled,
      },
      ...(franchisePool ? { franchise_pool: franchisePool } : {}),
      merchants: formattedMerchants,
      customers: formattedCustomers,
    }
  });
});

/**
 * Helper to resolve user by multiple possible identifiers:
 * id, user_id, userId, ID, User ID, phone, mobile, mobile_number, user_code, email
 */
async function resolveUserForT0Limit(rawId) {
  if (rawId === null || rawId === undefined || rawId === '') return null;

  const cleanId = String(rawId).trim();
  if (!cleanId) return null;

  // 1. If numeric integer, try User.findByPk first
  const numId = Number(cleanId);
  if (!isNaN(numId) && Number.isInteger(numId) && numId > 0) {
    const userByPk = await User.findByPk(numId);
    if (userByPk) return userByPk;
  }

  // 2. Otherwise try matching id as string, mobile_number, phone, user_code, email
  const userByQuery = await User.findOne({
    where: {
      [Op.or]: [
        { id: cleanId },
        { mobile_number: cleanId },
        { phone: cleanId },
        { user_code: cleanId },
        { email: cleanId }
      ]
    }
  });

  return userByQuery;
}

/**
 * Helper to parse t0_daily_limit from various possible input keys
 */
function parseLimitVal(rawLimit) {
  if (rawLimit === null || rawLimit === undefined || rawLimit === '') {
    return null;
  }
  if (typeof rawLimit === 'string' && rawLimit.toLowerCase() === 'unlimited') {
    return 'unlimited';
  }
  const parsed = parseFloat(rawLimit);
  if (isNaN(parsed) || parsed < 0) {
    throw new Error('t0_daily_limit must be a valid non-negative number, null, or unlimited');
  }
  return parsed;
}

/**
 * POST /api/admin/pos-setting/update-t0-limit
 * Single Body: { id | user_id | phone: 101, t0_daily_limit | amount | limit: 50000 | null }
 * Bulk Body: Array of objects OR { items | updates | data | rows: [...] }
 */
const updateT0Limit = asyncHandler(async (req, res) => {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'super_franchise' && role !== 'franchaise' && role !== 'franchise') {
    return res.status(403).json({ success: false, message: 'Admin, Super Franchise, or Franchise access only.' });
  }

  const serviceSettingsService = require('../services/serviceSettingsService');
  const isGlobalT0Enabled = await serviceSettingsService.getServiceFlagValue("pos_t0_settlement", true);
  const isUserDailyLimitEnabled = await serviceSettingsService.getServiceFlagValue("user_daily_limit", true);

  if (!isGlobalT0Enabled || !isUserDailyLimitEnabled) {
    const disabledKey = !isGlobalT0Enabled ? 'pos_t0_settlement' : 'user_daily_limit';
    return res.status(403).json({
      success: false,
      message: 'POS Settlement / Daily Limit service is globally disabled. T0 daily limit changes are not allowed while disabled.',
      code: 'SERVICE_DISABLED',
      service_key: disabledKey
    });
  }

  // Check if body is an array or contains an array of updates
  const items = Array.isArray(req.body)
    ? req.body
    : (Array.isArray(req.body?.items)
      ? req.body.items
      : (Array.isArray(req.body?.updates)
        ? req.body.updates
        : (Array.isArray(req.body?.data)
          ? req.body.data
          : (Array.isArray(req.body?.rows) ? req.body.rows : null))));

  // --- BULK ARRAY UPDATE ---
  if (items) {
    if (items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items provided for bulk update' });
    }

    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (const row of items) {
      const rawId = row.id ?? row.user_id ?? row.userId ?? row['User ID'] ?? row['User Id'] ?? row['user_id'] ?? row.ID ?? row.phone ?? row.mobile ?? row.mobile_number ?? row.number ?? row['Mobile Number'] ?? row['Phone'];
      const rawLimit = row.t0_daily_limit ?? row.amount ?? row.limit ?? row.t0Limit ?? row['T0 Limit'] ?? row['Amount'] ?? row['Limit'] ?? row['limit'] ?? row['t0_limit'];

      try {
        if (rawId === null || rawId === undefined || String(rawId).trim() === '') {
          failedCount++;
          results.push({ row, success: false, message: 'User identifier missing' });
          continue;
        }

        const user = await resolveUserForT0Limit(rawId);
        if (!user) {
          failedCount++;
          results.push({ row, identifier: rawId, success: false, message: 'User not found' });
          continue;
        }

        if (role === 'super_franchise' && user.super_franchise_id !== req.user.id && user.id !== req.user.id) {
          failedCount++;
          results.push({ row, identifier: rawId, success: false, message: 'User not assigned to your super franchise' });
          continue;
        }

        if ((role === 'franchaise' || role === 'franchise') && user.franchaise_id !== req.user.id) {
          failedCount++;
          results.push({ row, identifier: rawId, success: false, message: 'Merchant not assigned to your franchise' });
          continue;
        }

        const limitVal = parseLimitVal(rawLimit);

        await validateMerchantT0Limit({
          targetUser: user,
          requestedLimit: limitVal,
          requesterUser: req.user
        });

        user.t0_daily_limit = limitVal;
        await user.save();

        successCount++;
        results.push({
          row,
          id: user.id,
          name: user.name,
          mobile_number: user.mobile_number,
          t0_daily_limit: user.t0_daily_limit !== null ? String(user.t0_daily_limit) : null,
          success: true
        });
      } catch (err) {
        failedCount++;
        results.push({ row, identifier: rawId, success: false, message: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Bulk update complete. Updated ${successCount} user(s), ${failedCount} failed.`,
      data: {
        updated_count: successCount,
        failed_count: failedCount,
        results
      }
    });
  }

  // --- SINGLE UPDATE ---
  const rawId = req.body.id ?? req.body.user_id ?? req.body.userId ?? req.body['User ID'] ?? req.body['User Id'] ?? req.body.phone ?? req.body.mobile ?? req.body.mobile_number;
  const rawLimit = req.body.t0_daily_limit ?? req.body.amount ?? req.body.limit ?? req.body.t0Limit ?? req.body['T0 Limit'] ?? req.body['Amount'];

  if (rawId === null || rawId === undefined || String(rawId).trim() === '') {
    res.status(400);
    throw new Error('User id, user_id, or phone is required');
  }

  const user = await resolveUserForT0Limit(rawId);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  if (role === 'super_franchise') {
    if (user.super_franchise_id !== req.user.id && user.id !== req.user.id) {
      res.status(403);
      throw new Error('You can only update T0 limits for users assigned to your super franchise.');
    }
  } else if (role === 'franchaise' || role === 'franchise') {
    if (user.franchaise_id !== req.user.id) {
      res.status(403);
      throw new Error('You can only update T0 limits for merchants assigned to your franchise.');
    }
  }

  const limitVal = parseLimitVal(rawLimit);

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
      user_id: user.id,
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

  const serviceSettingsService = require('../services/serviceSettingsService');
  const isGlobalT0Enabled = await serviceSettingsService.getServiceFlagValue("pos_t0_settlement", true);

  if (!isGlobalT0Enabled) {
    return res.status(403).json({
      success: false,
      message: 'POS T0 Settlement Evaluator is globally disabled. Settlement type changes are not allowed while disabled.',
      code: 'SERVICE_DISABLED',
      service_key: 'pos_t0_settlement'
    });
  }

  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
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
        company_id : companyId,
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

  const serviceSettingsService = require('../services/serviceSettingsService');
  const isGlobalT0Enabled = await serviceSettingsService.getServiceFlagValue("pos_t0_settlement", true);

  if (!isGlobalT0Enabled) {
    return res.status(403).json({
      success: false,
      message: 'POS T0 Settlement Evaluator is globally disabled. Bulk settlement type changes are not allowed while disabled.',
      code: 'SERVICE_DISABLED',
      service_key: 'pos_t0_settlement'
    });
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

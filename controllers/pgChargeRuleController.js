const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const PgChargeRule = require('../models/PgChargeRule');
const User = require('../models/User');
const PgChargeService = require('../services/pgChargeService');

function isFranchiseRole(role) {
  const r = String(role || '').toLowerCase().replace(/[-_]/g, '');
  return r === 'franchise' || r === 'franchaise';
}

function isSuperFranchiseRole(role) {
  const r = String(role || '').toLowerCase().replace(/[-_]/g, '');
  return r === 'superfranchise';
}

function parseDecimal(value) {
  if (value === undefined || value === null || value === '') return null;
  const f = parseFloat(value);
  return isNaN(f) ? null : f;
}

function validateRuleInput(body) {
  const errors = [];
  const percent = parseDecimal(body.charge_percent);
  if (percent === null || percent < 0) {
    errors.push('charge_percent must be a non-negative number');
  }

  const flat = parseDecimal(body.charge_flat);
  if (flat !== null && flat < 0) {
    errors.push('charge_flat must be a non-negative number');
  }

  const gstReq = body.gst_required;
  const gstPct = parseDecimal(body.gst_percent);
  if (gstReq && (gstPct === null || gstPct < 0)) {
    errors.push('gst_percent must be a non-negative number when gst_required is true');
  }

  const minAmt = parseDecimal(body.min_amount);
  if (minAmt !== null && minAmt < 0) {
    errors.push('min_amount cannot be negative');
  }

  const maxAmt = parseDecimal(body.max_amount);
  if (maxAmt !== null && maxAmt < 0) {
    errors.push('max_amount cannot be negative');
  }

  if (minAmt !== null && maxAmt !== null && minAmt > maxAmt) {
    errors.push('min_amount cannot be greater than max_amount');
  }

  return errors;
}

/**
 * Create PG Charge Rule
 */
const createPgChargeRule = asyncHandler(async (req, res) => {
  const errors = validateRuleInput(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  const {
    user_id,
    franchaise_id,
    super_franchise_id,
    gateway = 'ALL',
    payment_mode = 'ALL',
    card_type,
    card_brand,
    card_classification,
    settlement_type,
    channel = 'WEB',
    min_amount = 0,
    max_amount,
    charge_percent = 0,
    charge_flat = 0,
    gst_required = false,
    gst_percent = 0,
    is_active = true
  } = req.body;

  let effectiveUserId = user_id ? parseInt(user_id, 10) : null;
  let effectiveFranchise = franchaise_id ? parseInt(franchaise_id, 10) : null;
  let effectiveSuperFranchise = super_franchise_id ? parseInt(super_franchise_id, 10) : null;
  let targetUserRole = null;

  if (isSuperFranchiseRole(req.user.role)) {
    effectiveSuperFranchise = req.user.id;
    if (effectiveFranchise) {
      const fUser = await User.findByPk(effectiveFranchise);
      if (!fUser || String(fUser.super_franchise_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Franchise does not belong to your network' });
      }
    }
    if (effectiveUserId) {
      const mUser = await User.findByPk(effectiveUserId);
      if (!mUser) return res.status(404).json({ success: false, message: 'Merchant not found' });
      targetUserRole = mUser.role;
    }
  } else if (isFranchiseRole(req.user.role)) {
    effectiveFranchise = req.user.id;
    if (effectiveUserId) {
      const mUser = await User.findByPk(effectiveUserId);
      if (!mUser || String(mUser.franchaise_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Merchant does not belong to your franchise' });
      }
      targetUserRole = mUser.role;
    }
  }

  const callerRole = isFranchiseRole(req.user.role) ? 'franchaise' : req.user.role;
  const ruleScope = PgChargeService.deriveScope(callerRole, effectiveUserId, effectiveFranchise, effectiveSuperFranchise, targetUserRole);

  const normCardBrand = PgChargeService.normalizeCardBrand(card_brand);
  const normGateway = String(gateway || 'ALL').toLowerCase();

  const existingRules = await PgChargeRule.findAll({
    where: {
      user_id: effectiveUserId,
      company_id: req.user.company_id || null,
      franchaise_id: effectiveFranchise,
      super_franchise_id: effectiveSuperFranchise,
      scope: ruleScope,
      gateway: normGateway,
      payment_mode: payment_mode || 'ALL',
      card_type: card_type || null,
      card_brand: normCardBrand || null,
      card_classification: card_classification || null,
      settlement_type: settlement_type || null,
      is_active: true
    }
  });

  const newMin = parseDecimal(min_amount) || 0;
  const newMax = parseDecimal(max_amount);
  const m1 = newMin;
  const m2 = newMax !== null ? newMax : Infinity;

  const duplicateOverlap = existingRules.find((r) => {
    if (r.is_active === false) return false;
    const rMin = r.min_amount != null ? parseFloat(r.min_amount) : 0;
    const rMax = r.max_amount != null && !isNaN(parseFloat(r.max_amount)) ? parseFloat(r.max_amount) : null;
    const s1 = rMin;
    const s2 = rMax !== null ? rMax : Infinity;
    return m1 <= s2 && m2 >= s1;
  });

  if (duplicateOverlap) {
    const existingRange = `${duplicateOverlap.min_amount != null ? duplicateOverlap.min_amount : 0} - ${duplicateOverlap.max_amount != null ? duplicateOverlap.max_amount : 'Open'}`;
    return res.status(400).json({
      success: false,
      message: `A duplicate PG charge rule with matching specifications and overlapping amount slab (${existingRange}) already exists.`
    });
  }

  const newRule = await PgChargeRule.create({
    user_id: effectiveUserId,
    company_id: req.user.company_id || null,
    franchaise_id: effectiveFranchise,
    super_franchise_id: effectiveSuperFranchise,
    created_by: req.user.id,
    scope: ruleScope,
    gateway: normGateway,
    payment_mode: payment_mode || 'ALL',
    card_type: card_type || null,
    card_brand: normCardBrand || null,
    card_classification: card_classification || null,
    settlement_type: settlement_type || null,
    channel: channel || 'WEB',
    min_amount: min_amount || 0,
    max_amount: max_amount || null,
    charge_percent: parseFloat(charge_percent) || 0,
    charge_flat: parseFloat(charge_flat) || 0,
    gst_required: Boolean(gst_required),
    gst_percent: parseFloat(gst_percent) || 0,
    is_active: is_active !== undefined ? Boolean(is_active) : true
  });

  res.status(201).json({
    success: true,
    message: 'PG charge rule created successfully',
    data: newRule
  });
});

/**
 * List PG Charge Rules with pagination and filters
 */
const listPgChargeRules = asyncHandler(async (req, res) => {
  const {
    gateway,
    payment_mode,
    scope,
    user_id,
    franchaise_id,
    super_franchise_id,
    is_active,
    page = 1,
    limit = 50
  } = req.query;

  const where = {};
  if (gateway) where.gateway = String(gateway).toLowerCase();
  if (payment_mode) where.payment_mode = payment_mode;
  if (scope) where.scope = scope;
  if (is_active !== undefined) where.is_active = is_active === 'true' || is_active === true;

  if (isFranchiseRole(req.user.role)) {
    where[Op.or] = [
      { franchaise_id: req.user.id },
      { scope: { [Op.in]: ['admin_default', 'super_admin_default', 'super_franchise_default', 'franchise_default'] } }
    ];
  } else if (isSuperFranchiseRole(req.user.role)) {
    where[Op.or] = [
      { super_franchise_id: req.user.id },
      { scope: { [Op.in]: ['admin_default', 'super_admin_default', 'super_franchise_default'] } }
    ];
  } else if (req.user.role === 'merchant' || req.user.role === 'retailer') {
    where[Op.or] = [
      { user_id: req.user.id },
      ...(req.user.franchaise_id ? [{ franchaise_id: req.user.franchaise_id }] : []),
      ...(req.user.super_franchise_id ? [{ super_franchise_id: req.user.super_franchise_id }] : []),
      { scope: { [Op.in]: ['admin_default', 'franchise_default', 'super_franchise_default', 'super_admin_default'] } }
    ];
  }

  if (user_id) where.user_id = parseInt(user_id, 10);
  if (franchaise_id) where.franchaise_id = parseInt(franchaise_id, 10);
  if (super_franchise_id) where.super_franchise_id = parseInt(super_franchise_id, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const { count, rows } = await PgChargeRule.findAndCountAll({
    where,
    limit: parseInt(limit, 10),
    offset,
    order: [['id', 'DESC']]
  });

  res.json({
    success: true,
    data: rows,
    pagination: {
      total: count,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(count / parseInt(limit, 10))
    }
  });
});

/**
 * List Merchant-grouped PG charge rules for authenticated merchant
 */
const listPgMerchantChargeRules = asyncHandler(async (req, res) => {
  const merchantId = req.user.id;
  const user = await User.findByPk(merchantId);
  const franchiseId = user ? user.franchaise_id : null;
  const superFranchiseId = user ? user.super_franchise_id : null;

  const rules = await PgChargeRule.findAll({
    where: {
      is_active: true,
      [Op.or]: [
        { user_id: merchantId },
        { franchaise_id: franchiseId, scope: 'franchise_default' },
        { super_franchise_id: superFranchiseId, scope: 'super_franchise_default' },
        { scope: 'admin_default' },
        { scope: 'super_admin_default' }
      ]
    },
    order: [['min_amount', 'ASC'], ['id', 'DESC']]
  });

  res.json({
    success: true,
    data: rules
  });
});

/**
 * List Admin/Upline rules for Franchise reference
 */
const listPgFranchiseAdminRules = asyncHandler(async (req, res) => {
  const rules = await PgChargeRule.findAll({
    where: {
      is_active: true,
      scope: {
        [Op.in]: ['admin_default', 'super_admin_default', 'super_franchise_default']
      }
    },
    order: [['min_amount', 'ASC'], ['id', 'DESC']]
  });

  res.json({
    success: true,
    data: rules
  });
});

/**
 * List Franchise Custom / Downline Rules
 */
const listPgFranchiseCustomRules = asyncHandler(async (req, res) => {
  const franchiseId = isFranchiseRole(req.user.role) ? req.user.id : (req.query.franchaise_id || null);

  const where = {
    is_active: true,
    [Op.or]: [
      { franchaise_id: franchiseId },
      { created_by: req.user.id }
    ]
  };

  if (req.query.user_id) {
    where.user_id = parseInt(req.query.user_id, 10);
  }

  const rules = await PgChargeRule.findAll({
    where,
    order: [['min_amount', 'ASC'], ['id', 'DESC']]
  });

  res.json({
    success: true,
    data: rules
  });
});

/**
 * Get PG Charge Rule by ID
 */
const getPgChargeRule = asyncHandler(async (req, res) => {
  const rule = await PgChargeRule.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'PG Charge Rule not found' });
  }

  res.json({ success: true, data: rule });
});

/**
 * Update PG Charge Rule
 */
const updatePgChargeRule = asyncHandler(async (req, res) => {
  const rule = await PgChargeRule.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'PG Charge Rule not found' });
  }

  const errors = validateRuleInput(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  const {
    charge_percent,
    charge_flat,
    gst_required,
    gst_percent,
    min_amount,
    max_amount,
    is_active
  } = req.body;

  const updateData = {};
  if (charge_percent !== undefined) updateData.charge_percent = parseFloat(charge_percent);
  if (charge_flat !== undefined) updateData.charge_flat = parseFloat(charge_flat);
  if (gst_required !== undefined) updateData.gst_required = Boolean(gst_required);
  if (gst_percent !== undefined) updateData.gst_percent = parseFloat(gst_percent);
  if (min_amount !== undefined) updateData.min_amount = parseFloat(min_amount);
  if (max_amount !== undefined) updateData.max_amount = max_amount ? parseFloat(max_amount) : null;
  if (is_active !== undefined) updateData.is_active = Boolean(is_active);

  await rule.update(updateData);

  res.json({
    success: true,
    message: 'PG Charge Rule updated successfully',
    data: rule
  });
});

/**
 * Delete PG Charge Rule
 */
const deletePgChargeRule = asyncHandler(async (req, res) => {
  const rule = await PgChargeRule.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'PG Charge Rule not found' });
  }

  await rule.destroy();
  res.json({ success: true, message: 'PG Charge Rule deleted successfully' });
});

/**
 * Test calculation for PG transaction
 */
const calculatePgCharge = asyncHandler(async (req, res) => {
  const { amount, gateway = 'ALL', payment_mode = 'ALL', user_id } = req.body;
  const numAmount = parseFloat(amount) || 0;

  const targetUserId = user_id || req.user.id;
  const rule = await PgChargeService.getChargeRule({
    userId: targetUserId,
    companyId: req.user.company_id,
    gateway,
    paymentMode: payment_mode,
    amount: numAmount
  });

  const calculation = PgChargeService.calculateCharge(numAmount, rule);
  res.json({
    success: true,
    data: {
      ...calculation,
      rule
    }
  });
});

module.exports = {
  createPgChargeRule,
  listPgChargeRules,
  listPgMerchantChargeRules,
  listPgFranchiseAdminRules,
  listPgFranchiseCustomRules,
  getPgChargeRule,
  updatePgChargeRule,
  deletePgChargeRule,
  calculatePgCharge
};

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
  const normalizedRole = String(req.user.role || '').toLowerCase().replace(/[-_]/g, '');
  const isCallerAdmin = normalizedRole === 'superadmin' || normalizedRole === 'admin';

  const ruleScope = PgChargeService.deriveScope(callerRole, effectiveUserId, effectiveFranchise, effectiveSuperFranchise, targetUserRole);

  // Normalized tokens for consistent DB storage & matching
  const normGateway = String(gateway || 'ALL').trim().toLowerCase();
  const normPaymentMode = String(payment_mode || 'ALL').trim().toUpperCase();
  const rawTypeStr = card_type ? String(card_type).trim().toUpperCase().replace(/[\s_-]/g, '').replace('CARD', '') : null;
  const normCardType = (!rawTypeStr || rawTypeStr === 'ALL' || rawTypeStr === 'UNKNOWN') ? null : rawTypeStr;
  const rawBrandNorm = card_brand ? PgChargeService.normalizeCardBrand(card_brand) : null;
  const cleanCardBrand = (!rawBrandNorm || rawBrandNorm === 'ALL') ? null : rawBrandNorm;

  if (!isCallerAdmin) {
    const downlineScopes = [
      'super_franchise_default', 'super_franchise_franchise', 'super_franchise_merchant',
      'franchise_default', 'franchise_merchant'
    ];
    if (!downlineScopes.includes(ruleScope)) {
      return res.status(403).json({
        success: false,
        message: 'Only Admin and Super Admin can create base rate rules. Super Franchise and Franchise can only set rates for their downline.'
      });
    }

    // Verify upline rule exists with matching specifications and exact slab
    const isCallerSF = isSuperFranchiseRole(req.user.role);
    const isCallerF = isFranchiseRole(req.user.role);

    let uplineScopes = [];
    if (isCallerSF) {
      uplineScopes = ['admin_super_franchise', 'admin_default', 'super_admin_admin', 'super_admin_default'];
    } else if (isCallerF) {
      uplineScopes = ['super_franchise_franchise', 'super_franchise_default', 'admin_franchise', 'admin_super_franchise', 'admin_default', 'super_admin_admin', 'super_admin_default'];
    } else {
      uplineScopes = ['admin_default', 'super_admin_admin', 'super_admin_default'];
    }

    const scopePriorityOrder = [
      [db.literal(`CASE scope
        WHEN 'super_franchise_franchise' THEN 900000
        WHEN 'super_franchise_default'   THEN 800000
        WHEN 'admin_franchise'           THEN 600000
        WHEN 'admin_super_franchise'     THEN 500000
        WHEN 'super_admin_admin'         THEN 450000
        WHEN 'admin_default'             THEN 400000
        WHEN 'super_admin_default'       THEN 200000
        ELSE 0
      END`), 'DESC'],
      ['id', 'DESC']
    ];

    // 1. Strict exact match
    const uplineWhere = {
      scope: { [Op.in]: uplineScopes },
      payment_mode: normPaymentMode,
      min_amount: min_amount != null ? parseFloat(min_amount) : 0,
      is_active: true
    };
    if (max_amount !== null && max_amount !== undefined && max_amount !== '' && !isNaN(parseFloat(max_amount))) {
      uplineWhere.max_amount = parseFloat(max_amount);
    } else {
      uplineWhere.max_amount = null;
    }
    if (cleanCardBrand) uplineWhere.card_brand = cleanCardBrand;
    if (normCardType) uplineWhere.card_type = normCardType;
    if (settlement_type) uplineWhere.settlement_type = settlement_type;

    if (isCallerSF) {
      uplineWhere[Op.or] = [
        { super_franchise_id: req.user.id },
        { super_franchise_id: null }
      ];
    } else if (isCallerF) {
      uplineWhere[Op.or] = [
        { franchaise_id: req.user.id },
        { franchaise_id: null }
      ];
    }

    let uplineRule = await PgChargeRule.findOne({ where: uplineWhere, order: scopePriorityOrder });

    // 2. Wildcard fallback: Brand or Type fallback to 'ALL' / NULL
    if (!uplineRule) {
      const wildcardWhere = {
        scope: uplineWhere.scope,
        payment_mode: normPaymentMode,
        min_amount: uplineWhere.min_amount,
        max_amount: uplineWhere.max_amount,
        is_active: true
      };
      if (isCallerSF) {
        wildcardWhere[Op.or] = [
          { super_franchise_id: req.user.id },
          { super_franchise_id: null }
        ];
      } else if (isCallerF) {
        wildcardWhere[Op.or] = [
          { franchaise_id: req.user.id },
          { franchaise_id: null }
        ];
      }
      if (cleanCardBrand) wildcardWhere.card_brand = { [Op.in]: [cleanCardBrand, 'ALL', null] };
      if (normCardType) wildcardWhere.card_type = { [Op.in]: [normCardType, 'ALL', null] };
      if (settlement_type) wildcardWhere.settlement_type = { [Op.in]: [settlement_type, 'ANY', null] };
      uplineRule = await PgChargeRule.findOne({ where: wildcardWhere, order: scopePriorityOrder });
    }

    // 3. Open slab fallback: slab min/max fallback
    if (!uplineRule) {
      const slabFallbackWhere = {
        scope: uplineWhere.scope,
        payment_mode: normPaymentMode,
        is_active: true
      };
      if (isCallerSF) {
        slabFallbackWhere[Op.or] = [
          { super_franchise_id: req.user.id },
          { super_franchise_id: null }
        ];
      } else if (isCallerF) {
        slabFallbackWhere[Op.or] = [
          { franchaise_id: req.user.id },
          { franchaise_id: null }
        ];
      }
      if (cleanCardBrand) slabFallbackWhere.card_brand = { [Op.in]: [cleanCardBrand, 'ALL', null] };
      if (normCardType) slabFallbackWhere.card_type = { [Op.in]: [normCardType, 'ALL', null] };
      if (settlement_type) slabFallbackWhere.settlement_type = { [Op.in]: [settlement_type, 'ANY', null] };
      uplineRule = await PgChargeRule.findOne({ where: slabFallbackWhere, order: scopePriorityOrder });
    }

    if (!uplineRule) {
      return res.status(400).json({
        success: false,
        message: 'Cannot create rate: payment mode, network, card type, settlement type, and slab amounts must first be defined by Admin or Super Admin.'
      });
    }

    const uplineFlat = parseFloat(uplineRule.charge_flat || 0);
    const uplinePercent = parseFloat(uplineRule.charge_percent || 0);

    // Downline inherits GST setting from upline rule
    gst_required = Boolean(uplineRule.gst_required);
    gst_percent = parseFloat(uplineRule.gst_percent || 0);

    if (uplineFlat > 0 && uplinePercent <= 0) {
      if (parseFloat(charge_percent || 0) > 0 && parseFloat(charge_flat || 0) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'The base rate for this specification is Flat Rate and cannot be converted to percentage.'
        });
      }
      if (parseFloat(charge_flat || 0) < uplineFlat) {
        return res.status(400).json({
          success: false,
          message: `Flat charge (₹${charge_flat}) cannot be less than the previously set flat rate of ₹${uplineFlat}.`
        });
      }
    } else if (uplinePercent > 0 && parseFloat(charge_flat || 0) <= 0) {
      if (parseFloat(charge_flat || 0) > 0 && parseFloat(charge_percent || 0) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'The base rate for this specification is Percentage and cannot be converted to Flat Rate.'
        });
      }
      if (parseFloat(charge_percent || 0) < uplinePercent) {
        return res.status(400).json({
          success: false,
          message: `Rate (${charge_percent}%) cannot be less than the previously set rate of ${uplinePercent}%.`
        });
      }
    }
  }

  let existingRules;
  const duplicateWhere = {
    user_id: effectiveUserId,
    company_id: req.user.company_id || null,
    franchaise_id: effectiveFranchise,
    super_franchise_id: effectiveSuperFranchise,
    scope: ruleScope,
    gateway: normGateway,
    payment_mode: normPaymentMode,
    card_type: normCardType,
    card_brand: cleanCardBrand,
    card_classification: card_classification || null,
    settlement_type: settlement_type || null,
    is_active: true
  };
  try {
    existingRules = await PgChargeRule.findAll({ where: duplicateWhere });
  } catch (findErr) {
    if (findErr.message && findErr.message.includes('pg_charge_rules') && findErr.message.includes('does not exist')) {
      await PgChargeRule.sync();
      existingRules = await PgChargeRule.findAll({ where: duplicateWhere });
    } else {
      throw findErr;
    }
  }

  const newMin = parseDecimal(min_amount) || 0;
  const newMax = parseDecimal(max_amount);
  const m1 = newMin;
  const m2 = newMax !== null ? newMax : Infinity;

  const exactRule = existingRules.find((r) => {
    if (r.is_active === false) return false;
    const rMin = r.min_amount != null ? parseFloat(r.min_amount) : 0;
    const rMax = r.max_amount != null && !isNaN(parseFloat(r.max_amount)) ? parseFloat(r.max_amount) : null;
    return rMin === newMin && rMax === newMax;
  });

  if (exactRule) {
    await exactRule.update({
      charge_percent: charge_percent || 0,
      charge_flat: charge_flat || 0,
      gst_required: Boolean(gst_required),
      gst_percent: gst_percent !== undefined && gst_percent !== null ? gst_percent : 0,
      is_active: typeof is_active === 'boolean' ? is_active : true,
    });
    return res.status(200).json({ success: true, message: 'PG Charge Rule updated', data: exactRule });
  }

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

  const newRuleData = {
    user_id: effectiveUserId,
    company_id: req.user.company_id || null,
    franchaise_id: effectiveFranchise,
    super_franchise_id: effectiveSuperFranchise,
    created_by: req.user.id,
    scope: ruleScope,
    gateway: normGateway,
    payment_mode: normPaymentMode,
    card_type: normCardType,
    card_brand: cleanCardBrand,
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
  };

  let newRule;
  try {
    newRule = await PgChargeRule.create(newRuleData);
  } catch (createErr) {
    if (createErr.message && createErr.message.includes('pg_charge_rules') && createErr.message.includes('does not exist')) {
      await PgChargeRule.sync();
      newRule = await PgChargeRule.create(newRuleData);
    } else {
      throw createErr;
    }
  }

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

  let parentAdminId = req.user.admin_id || null;
  if (!parentAdminId && req.user.company_id) {
    try {
      const adminUser = await User.findOne({
        where: { role: 'admin', company_id: req.user.company_id },
        attributes: ['id']
      });
      if (adminUser) parentAdminId = adminUser.id;
    } catch (e) {}
  }

  if (isFranchiseRole(req.user.role)) {
    if (scope === 'super_admin_admin') {
      where.user_id = parentAdminId;
    } else if (!scope) {
      where[Op.or] = [
        { franchaise_id: req.user.id },
        { scope: { [Op.in]: ['admin_default', 'super_admin_default', 'super_franchise_default', 'franchise_default'] } },
        ...(parentAdminId ? [{ scope: 'super_admin_admin', user_id: parentAdminId }] : [])
      ];
    }
  } else if (isSuperFranchiseRole(req.user.role)) {
    if (scope === 'super_admin_admin') {
      where.user_id = parentAdminId;
    } else if (!scope) {
      where[Op.or] = [
        { super_franchise_id: req.user.id },
        { scope: { [Op.in]: ['admin_default', 'super_admin_default', 'super_franchise_default'] } },
        ...(parentAdminId ? [{ scope: 'super_admin_admin', user_id: parentAdminId }] : [])
      ];
    }
  } else if (req.user.role === 'admin') {
    if (scope === 'super_admin_admin') {
      where.user_id = req.user.id;
    }
  } else if (req.user.role === 'merchant' || req.user.role === 'retailer') {
    if (scope === 'super_admin_admin') {
      where.user_id = parentAdminId;
    } else if (!scope) {
      where[Op.or] = [
        { user_id: req.user.id },
        ...(req.user.franchaise_id ? [{ franchaise_id: req.user.franchaise_id }] : []),
        ...(req.user.super_franchise_id ? [{ super_franchise_id: req.user.super_franchise_id }] : []),
        { scope: { [Op.in]: ['admin_default', 'franchise_default', 'super_franchise_default', 'super_admin_default'] } },
        ...(parentAdminId ? [{ scope: 'super_admin_admin', user_id: parentAdminId }] : [])
      ];
    }
  }

  if (user_id) where.user_id = parseInt(user_id, 10);
  if (franchaise_id) where.franchaise_id = parseInt(franchaise_id, 10);
  if (super_franchise_id) where.super_franchise_id = parseInt(super_franchise_id, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  let count = 0, rows = [];
  try {
    const resData = await PgChargeRule.findAndCountAll({
      where,
      limit: parseInt(limit, 10),
      offset,
      order: [['id', 'DESC']]
    });
    count = resData.count;
    rows = resData.rows;
  } catch (listErr) {
    if (listErr.message && listErr.message.includes('pg_charge_rules') && listErr.message.includes('does not exist')) {
      await PgChargeRule.sync();
      const resData = await PgChargeRule.findAndCountAll({
        where,
        limit: parseInt(limit, 10),
        offset,
        order: [['id', 'DESC']]
      });
      count = resData.count;
      rows = resData.rows;
    } else {
      throw listErr;
    }
  }

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

  const normalizedRole = String(req.user?.role || '').toLowerCase().replace(/[-_]/g, '');
  const isCallerAdmin = normalizedRole === 'superadmin' || normalizedRole === 'admin';

  const isSuperFranchise = isSuperFranchiseRole(req.user?.role);
  const isFranchise = isFranchiseRole(req.user?.role);

  const isAuthorized = (
    isCallerAdmin ||
    rule.created_by === req.user.id ||
    (isSuperFranchise && (rule.super_franchise_id === req.user.id || rule.scope === 'super_franchise_default')) ||
    (isFranchise && (rule.franchaise_id === req.user.id || rule.scope === 'franchise_default'))
  );

  if (!isAuthorized) {
    return res.status(403).json({ success: false, message: 'Only the creator, parent franchise, or admin can update this rule' });
  }

  if (!isCallerAdmin) {
    const downlineScopes = [
      'super_franchise_default', 'super_franchise_franchise', 'super_franchise_merchant',
      'franchise_default', 'franchise_merchant'
    ];
    if (!downlineScopes.includes(rule.scope)) {
      return res.status(403).json({
        success: false,
        message: 'Only Admin and Super Admin can edit base rate rules and payment specifications.'
      });
    }
  }

  const errors = validateRuleInput(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  const resolvedPercent = req.body.charge_percent !== undefined ? parseFloat(req.body.charge_percent) : null;
  const resolvedFlat = req.body.charge_flat !== undefined ? parseFloat(req.body.charge_flat) : null;

  // Query upline rule to get base cost floor for this specification and slab
  const normRuleMode = String(rule.payment_mode || 'ALL').trim().toUpperCase();
  const rawRuleBrand = rule.card_brand;
  const normRuleBrand = rawRuleBrand ? PgChargeService.normalizeCardBrand(rawRuleBrand) : null;
  const cleanRuleBrand = (!normRuleBrand || normRuleBrand === 'ALL') ? null : normRuleBrand;
  const rawRuleType = rule.card_type;
  const cleanRuleType = rawRuleType ? String(rawRuleType).trim().toUpperCase().replace(/[\s_-]/g, '').replace('CARD', '') : null;
  const normRuleType = (!cleanRuleType || cleanRuleType === 'ALL' || cleanRuleType === 'UNKNOWN') ? null : cleanRuleType;

  // Determine allowed upline scopes based on the rule being updated
  let uplineScopes = [];
  if (['admin_super_franchise', 'admin_franchise', 'admin_merchant'].includes(rule.scope)) {
    uplineScopes = ['admin_default', 'super_admin_admin', 'super_admin_default'];
  } else if (rule.scope === 'admin_default') {
    uplineScopes = ['super_admin_admin', 'super_admin_default'];
  } else if (rule.scope === 'super_admin_admin') {
    uplineScopes = ['super_admin_default'];
  } else if (['super_franchise_default', 'super_franchise_franchise', 'super_franchise_merchant'].includes(rule.scope)) {
    uplineScopes = ['admin_super_franchise', 'admin_default', 'super_admin_admin', 'super_admin_default'];
  } else if (['franchise_default', 'franchise_merchant'].includes(rule.scope)) {
    uplineScopes = ['super_franchise_franchise', 'super_franchise_default', 'admin_franchise', 'admin_super_franchise', 'admin_default', 'super_admin_admin', 'super_admin_default'];
  } else {
    uplineScopes = ['super_admin_default'];
  }

  let uplineRule = null;
  if (rule.scope !== 'super_admin_default' && uplineScopes.length > 0) {
    const scopePriorityOrder = [
      [db.literal(`CASE scope
        WHEN 'super_franchise_franchise' THEN 900000
        WHEN 'super_franchise_default'   THEN 800000
        WHEN 'admin_franchise'           THEN 600000
        WHEN 'admin_super_franchise'     THEN 500000
        WHEN 'super_admin_admin'         THEN 450000
        WHEN 'admin_default'             THEN 400000
        WHEN 'super_admin_default'       THEN 200000
        ELSE 0
      END`), 'DESC'],
      ['id', 'DESC']
    ];

    const uplineWhere = {
      id: { [Op.ne]: rule.id },
      scope: { [Op.in]: uplineScopes },
      payment_mode: normRuleMode,
      min_amount: rule.min_amount != null ? parseFloat(rule.min_amount) : 0,
      is_active: true
    };
    if (rule.max_amount !== null && rule.max_amount !== undefined && !isNaN(parseFloat(rule.max_amount))) {
      uplineWhere.max_amount = parseFloat(rule.max_amount);
    } else {
      uplineWhere.max_amount = null;
    }
    if (cleanRuleBrand) uplineWhere.card_brand = cleanRuleBrand;
    if (normRuleType) uplineWhere.card_type = normRuleType;
    if (rule.settlement_type) uplineWhere.settlement_type = rule.settlement_type;

    if (rule.super_franchise_id) {
      uplineWhere[Op.or] = [
        { super_franchise_id: rule.super_franchise_id },
        { super_franchise_id: null }
      ];
    } else if (rule.franchaise_id) {
      uplineWhere[Op.or] = [
        { franchaise_id: rule.franchaise_id },
        { franchaise_id: null }
      ];
    }

    uplineRule = await PgChargeRule.findOne({ where: uplineWhere, order: scopePriorityOrder });

    // Wildcard fallback: Brand or Type fallback to 'ALL' / NULL
    if (!uplineRule) {
      const wildcardWhere = {
        id: { [Op.ne]: rule.id },
        scope: uplineWhere.scope,
        payment_mode: normRuleMode,
        min_amount: uplineWhere.min_amount,
        max_amount: uplineWhere.max_amount,
        is_active: true
      };
      if (rule.super_franchise_id) {
        wildcardWhere[Op.or] = [
          { super_franchise_id: rule.super_franchise_id },
          { super_franchise_id: null }
        ];
      } else if (rule.franchaise_id) {
        wildcardWhere[Op.or] = [
          { franchaise_id: rule.franchaise_id },
          { franchaise_id: null }
        ];
      }
      if (cleanRuleBrand) wildcardWhere.card_brand = { [Op.in]: [cleanRuleBrand, 'ALL', null] };
      if (normRuleType) wildcardWhere.card_type = { [Op.in]: [normRuleType, 'ALL', null] };
      if (rule.settlement_type) wildcardWhere.settlement_type = { [Op.in]: [rule.settlement_type, 'ANY', null] };
      uplineRule = await PgChargeRule.findOne({ where: wildcardWhere, order: scopePriorityOrder });
    }

    // Open slab fallback
    if (!uplineRule) {
      const fallbackWhere = {
        id: { [Op.ne]: rule.id },
        scope: uplineWhere.scope,
        payment_mode: normRuleMode,
        is_active: true
      };
      if (rule.super_franchise_id) {
        fallbackWhere[Op.or] = [
          { super_franchise_id: rule.super_franchise_id },
          { super_franchise_id: null }
        ];
      } else if (rule.franchaise_id) {
        fallbackWhere[Op.or] = [
          { franchaise_id: rule.franchaise_id },
          { franchaise_id: null }
        ];
      }
      if (cleanRuleBrand) fallbackWhere.card_brand = { [Op.in]: [cleanRuleBrand, 'ALL', null] };
      if (normRuleType) fallbackWhere.card_type = { [Op.in]: [normRuleType, 'ALL', null] };
      if (rule.settlement_type) fallbackWhere.settlement_type = { [Op.in]: [rule.settlement_type, 'ANY', null] };
      uplineRule = await PgChargeRule.findOne({ where: fallbackWhere, order: scopePriorityOrder });
    }
  }

  const uplineFlat = uplineRule ? parseFloat(uplineRule.charge_flat || 0) : 0;
  const uplinePercent = uplineRule ? parseFloat(uplineRule.charge_percent || 0) : 0;

  if (uplineFlat > 0 && uplinePercent <= 0) {
    if (resolvedPercent != null && resolvedPercent > 0 && (resolvedFlat == null || resolvedFlat <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'This rate is configured as Flat Rate and cannot be converted to percentage.'
      });
    }
    if (resolvedFlat != null && resolvedFlat < uplineFlat && !(normalizedRole === 'superadmin' && rule.scope === 'super_admin_default')) {
      return res.status(400).json({
        success: false,
        message: `Flat rate (₹${resolvedFlat}) cannot be less than upline flat rate of ₹${uplineFlat}.`
      });
    }
  } else if (uplinePercent > 0 && (resolvedFlat == null || resolvedFlat <= 0)) {
    if (resolvedFlat != null && resolvedFlat > 0 && (resolvedPercent == null || resolvedPercent <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'This rate is configured as Percentage and cannot be converted to Flat Rate.'
      });
    }
    if (resolvedPercent != null && resolvedPercent < uplinePercent && !(normalizedRole === 'superadmin' && rule.scope === 'super_admin_default')) {
      return res.status(400).json({
        success: false,
        message: `Rate (${resolvedPercent}%) cannot be less than upline rate of ${uplinePercent}%.`
      });
    }
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

  // Only Admin and Super Admin can edit GST and min/max amounts
  if (isCallerAdmin) {
    if (gst_required !== undefined) updateData.gst_required = Boolean(gst_required);
    if (gst_percent !== undefined) updateData.gst_percent = parseFloat(gst_percent);
    if (min_amount !== undefined) updateData.min_amount = parseFloat(min_amount);
    if (max_amount !== undefined) updateData.max_amount = max_amount ? parseFloat(max_amount) : null;
  }

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

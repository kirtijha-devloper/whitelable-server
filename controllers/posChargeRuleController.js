const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const PosChargeRule = require('../models/PosChargeRule');
const User = require('../models/User');

// helper to cope with inconsistent spelling of the franchise role.
// historically the DB stored "franchaise" (typo) while front‑end sends
// "franchise"; we accept either until all rows are normalised.
function isFranchiseRole(role) {
  return role === 'franchaise' || role === 'franchise';
}
const ChargeService = require('../services/chargeService');
const { deriveScope, normalizeCardBrand } = ChargeService;

// simple file logger for debugging
const logFile = path.join(__dirname, '../logs/posChargeRule.log');
function fileLog(message) {
  const timestamp = new Date().toISOString();
  fs.appendFile(logFile, `[${timestamp}] ${message}\n`, (err) => {
    if (err) console.error('log write failed', err);
  });
}

// helper: parse decimal input (string or number) to float or null
function parseDecimal(value) {
  if (value === undefined || value === null || value === '') return null;
  const f = parseFloat(value);
  return isNaN(f) ? null : f;
}

// validation common to create/update
function validateRuleInput(body) {
  const errors = [];

  if (!body.payment_mode && body.payment_mode !== null) {
    errors.push('payment_mode is required');
  }
  const percent = parseDecimal(body.charge_percent);
  if (percent === null || percent < 0) {
    errors.push('charge_percent must be a non-negative number');
  }

  const gstReq = body.gst_required;
  const gstPct = parseDecimal(body.gst_percent);
  if (gstReq) {
    if (gstPct === null || gstPct < 0) {
      errors.push('gst_percent must be a non-negative number when gst_required is true');
    }
  }
  if (gstPct !== null && gstPct < 0) {
    errors.push('gst_percent must be a non-negative number');
  }

  const min = parseDecimal(body.min_amount) || 0;
  const max = parseDecimal(body.max_amount);
  if (max !== null && min > max) {
    errors.push('min_amount cannot be greater than max_amount');
  }

  return errors;
}

// create rule
const createPosChargeRule = asyncHandler(async (req, res) => {
  fileLog(`CREATE request body: ${JSON.stringify(req.body)}`);
  const {
    user_id,
    franchaise_id,
    super_franchise_id,
    payment_mode,
    card_type,
    card_brand,
    card_classification,
    settlement_type,
    min_amount,
    max_amount,
    charge_percent,
    charge_flat,
    gst_required,
    gst_percent,
    is_active,
    company_name
  } = req.body;
  // we will also record who created this rule for later filtering/permissions
  const creatorId = req.user && req.user.id ? req.user.id : null;

  // basic validation (franchaise_id & super_franchise_id are optional and numeric)
  const errs = validateRuleInput(req.body);
  if (franchaise_id !== undefined && franchaise_id !== null && isNaN(parseInt(franchaise_id, 10))) {
    errs.push('franchaise_id must be an integer');
  }
  if (super_franchise_id !== undefined && super_franchise_id !== null && isNaN(parseInt(super_franchise_id, 10))) {
    errs.push('super_franchise_id must be an integer');
  }
  if (errs.length) {
    return res.status(400).json({ success: false, errors: errs });
  }

  // determine effective super franchise & franchise ids for this request
  let effectiveSuperFranchise = super_franchise_id || null;
  let effectiveFranchise = franchaise_id || null;

  if (req.user.role === 'super_franchise') {
    if (effectiveSuperFranchise && parseInt(effectiveSuperFranchise) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Cannot set rule for another super franchise' });
    }
    effectiveSuperFranchise = req.user.id;
  }

  if (req.user.role === 'franchaise' || req.user.role === 'franchise') {
    // franchise may only create rules for their own franchise or their merchants
    if (effectiveFranchise && parseInt(effectiveFranchise) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Cannot set rule for another franchise' });
    }
    // force the franchise id to caller's id when creating defaults (no user_id)
    effectiveFranchise = req.user.id;
  }

  // if caller is a franchise and specifying a merchant, ensure ownership
  if ((req.user.role === 'franchaise' || req.user.role === 'franchise') && user_id) {
    // franchise users are not allowed to create rules for themselves
    if (parseInt(user_id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'Franchise cannot create a rule for themselves' });
    }
    const target = await User.findByPk(user_id);
    if (!target || String(target.franchaise_id) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Merchant does not belong to your franchise' });
    }
  }

  // determine the scope of this rule
  const callerRole = isFranchiseRole(req.user.role) ? 'franchaise' : req.user.role;
  const ruleScope = deriveScope(callerRole, user_id || null, effectiveFranchise, effectiveSuperFranchise);

  // duplicate check: exact same combination including franchise and super franchise
  const normalizedCardBrand = normalizeCardBrand(card_brand);

  const duplicate = await PosChargeRule.findOne({
    where: {
      user_id: user_id || null,
      franchaise_id: effectiveFranchise,
      super_franchise_id: effectiveSuperFranchise,
      scope: ruleScope,
      payment_mode: payment_mode || null,
      card_type: card_type || null,
      card_brand: normalizedCardBrand || null,
      card_classification: card_classification || null,
      settlement_type: settlement_type || null,
      company_name: company_name || null,
      min_amount: min_amount !== undefined ? min_amount : 0,
      max_amount: max_amount || null
    }
  });

  if (duplicate) {
    return res.status(400).json({
      success: false,
      message: 'A rule with the same parameters and amount slab already exists'
    });
  }

  // check for overlapping slabs in the same parameter combination
  const newMin = parseDecimal(min_amount) || 0;
  const newMax = parseDecimal(max_amount);
  const overlapCondition = {
    user_id: user_id || null,
    franchaise_id: effectiveFranchise,
    super_franchise_id: effectiveSuperFranchise,
    scope: ruleScope,
    payment_mode: payment_mode || null,
    card_type: card_type || null,
    card_brand: normalizedCardBrand || null,
    card_classification: card_classification || null,
    settlement_type: settlement_type || null,
    company_name: company_name || null
  };
  const existingSlabs = await PosChargeRule.findAll({ where: overlapCondition });
  const hasOverlap = existingSlabs.some((slab) => {
    const slabMin = slab.min_amount != null ? parseFloat(slab.min_amount) : 0;
    const slabMax = slab.max_amount != null ? parseFloat(slab.max_amount) : Infinity;
    const m1 = newMin;
    const m2 = newMax != null ? newMax : Infinity;
    return m1 <= slabMax && m2 >= slabMin;
  });
  if (hasOverlap) {
    return res.status(400).json({
      success: false,
      message: 'Amount slab overlaps with an existing rule in the same category'
    });
  }

  let rec;
  try {
    rec = await PosChargeRule.create({
      user_id: user_id || null,
      franchaise_id: effectiveFranchise,
      super_franchise_id: effectiveSuperFranchise,
      scope: ruleScope,
      payment_mode: payment_mode || null,
      card_type: card_type || null,
      card_brand: normalizedCardBrand || null,
      card_classification: card_classification || null,
      settlement_type: settlement_type || null,
      company_name: company_name || null,
      min_amount: min_amount !== undefined ? min_amount : 0,
      max_amount: max_amount || null,
      charge_percent,
      charge_flat: charge_flat || 0,
      gst_required: Boolean(gst_required),
      gst_percent: gst_percent !== undefined && gst_percent !== null ? gst_percent : 0,
      is_active: typeof is_active === 'boolean' ? is_active : true,
      created_by: creatorId
    });
  } catch (err) {
    fileLog(`CREATE error: ${err.message}`);
    throw err;
  }

  fileLog(`CREATE response id=${rec.id}`);
  res.status(201).json({ success: true, message: 'Charge rule created', record: rec });
});

// get single rule
const getPosChargeRule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: 'id required' });
  }
  const rec = await PosChargeRule.findByPk(id);
  if (!rec) {
    return res.status(404).json({ success: false, message: 'Rule not found' });
  }
  res.status(200).json({ success: true, record: rec });
});


// list only the rules that were provided by the system (admin/global) for a
// given franchise.  this endpoint is intended for a franchise user who wants
// to see the non‑editable set: global defaults plus any franchise‑level rules
// *not* created by the franchise itself.
const listFranchiseAdminRules = asyncHandler(async (req, res) => {
  if (!isFranchiseRole(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Only franchise users may call this endpoint' });
  }

  const {
    payment_mode,
    card_type,
    card_brand,
    card_classification,
    settlement_type,
    is_active,
    page = 1,
    limit = 20
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const where = {};
  if (payment_mode) where.payment_mode = payment_mode;
  if (card_type) where.card_type = card_type;
  if (card_brand) where.card_brand = card_brand;
  if (card_classification) where.card_classification = card_classification;
  if (settlement_type) where.settlement_type = settlement_type;
  if (is_active !== undefined) where.is_active = is_active === 'true' || is_active === true;

  // only global defaults or admin-set franchise rules (not editable by franchise)
  where[Op.or] = [
    { scope: 'admin_default' },
    { scope: 'admin_franchise', franchaise_id: req.user.id }
  ];

  const { count, rows } = await PosChargeRule.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset,
    order: [['createdAt', 'DESC']]
  });

  res.status(200).json({
    success: true,
    data: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / parseInt(limit))
    }
  });
});

// list the rules that the franchise user themselves created (for their own
// franchise or merchants).  results are editable by the caller.
const listFranchiseCustomRules = asyncHandler(async (req, res) => {
  if (!isFranchiseRole(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Only franchise users may call this endpoint' });
  }

  const {
    user_id,
    payment_mode,
    card_type,
    card_brand,
    card_classification,
    settlement_type,
    is_active,
    page = 1,
    limit = 20
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const where = { franchaise_id: req.user.id, scope: { [Op.in]: ['franchise_default', 'franchise_merchant'] } };
  if (user_id !== undefined) where.user_id = user_id || null;
  if (payment_mode) where.payment_mode = payment_mode;
  if (card_type) where.card_type = card_type;
  if (card_brand) where.card_brand = card_brand;
  if (card_classification) where.card_classification = card_classification;
  if (settlement_type) where.settlement_type = settlement_type;
  if (is_active !== undefined) where.is_active = is_active === 'true' || is_active === true;

  const { count, rows } = await PosChargeRule.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset,
    order: [['createdAt', 'DESC']]
  });

  res.status(200).json({
    success: true,
    data: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / parseInt(limit))
    }
  });
});

// list rules with filters & pagination
// this endpoint is generic and used internally by admin/merchant as well as
// by the UI when it wants everything; we leave it largely untouched
const listPosChargeRules = asyncHandler(async (req, res) => {
  const {
    user_id,
    franchaise_id,
    payment_mode,
    card_type,
    card_brand,
    card_classification,
    settlement_type,
    scope,
    is_active,
    company_name,
    page = 1,
    limit = 100
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const where = {};
  if (user_id !== undefined) where.user_id = user_id || null;
  if (franchaise_id !== undefined) where.franchaise_id = franchaise_id || null;
  if (payment_mode) where.payment_mode = payment_mode;
  if (card_type) where.card_type = card_type;
  if (card_brand) where.card_brand = card_brand;
  if (card_classification) where.card_classification = card_classification;
  if (settlement_type) where.settlement_type = settlement_type;
  if (scope) where.scope = scope;
  if (is_active !== undefined) where.is_active = is_active === 'true' || is_active === true;
  if (company_name) where.company_name = company_name;

  // merchants should not be able to request rules for someone else; if
  // `user_id` is supplied it must match the caller.  we also later ensure the
  // merchant always sees their own records even if the scope logic would
  // otherwise omit them.
  if (req.user.role === 'merchant') {
    const merchantRecord = await User.findByPk(req.user.id, { attributes: ['franchaise_id'] });
    req.user.franchaise_id = merchantRecord ? merchantRecord.franchaise_id : null;

    // merchants may not filter by another user or franchise; if either key is
    // present we check that it matches the caller and then throw away the
    // value.  a blank string in the query will be coerced to `null` above,
    // which would otherwise turn into an accidental filter (“franchaise_id is
    // null”) and hide all of the records the OR clause is intended to expose.
    if ('user_id' in where && where.user_id !== null) {
      const uid = parseInt(where.user_id, 10);
      if (uid !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Cannot filter by another user' });
      }
    }
    if ('franchaise_id' in where && where.franchaise_id !== null) {
      const fid = parseInt(where.franchaise_id, 10);
      if (fid !== req.user.franchaise_id) {
        return res.status(403).json({ success: false, message: 'Cannot filter by another franchise' });
      }
    }

    // merchants shouldn't need to supply either id when listing.  dropping
    // them ensures a stray empty value from the UI doesn't turn into a
    // restrictive `WHERE franchaise_id IS NULL` clause that excludes the very
    // defaults we're trying to return.
    delete where.user_id;
    delete where.franchaise_id;
  }

  // role-specific validation of incoming filters - prevents a franchise
  // from supplying a `user_id` or `franchaise_id` outside their scope and thus
  // leaking other merchants' rules.
  if (isFranchiseRole(req.user.role)) {
    // if the caller is a franchise, validate that any explicit filter ids belong to them
    const merchantRows = await User.findAll({
      where: { role: 'merchant', franchaise_id: req.user.id },
      attributes: ['id']
    });
    const merchantIds = merchantRows.map(m => m.id);
    const allowedUserIds = [req.user.id, ...merchantIds];

    if ('user_id' in where && where.user_id !== null) {
      const uid = parseInt(where.user_id, 10);
      if (!allowedUserIds.includes(uid)) {
        return res.status(403).json({ success: false, message: 'Cannot filter by a user outside your franchise' });
      }
    }
    if ('franchaise_id' in where && where.franchaise_id !== null) {
      const fid = parseInt(where.franchaise_id, 10);
      if (fid !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Cannot filter by another franchise' });
      }
    }
  }

  // apply role-based restrictions using scope
  if (req.user.role === 'super_franchise') {
    where[Op.or] = [
      { scope: 'admin_default' },
      { scope: 'admin_super_franchise', super_franchise_id: req.user.id },
      { scope: 'super_franchise_default', super_franchise_id: req.user.id },
      { scope: 'super_franchise_franchise', super_franchise_id: req.user.id },
      { scope: 'super_franchise_merchant', super_franchise_id: req.user.id }
    ];
  } else if (isFranchiseRole(req.user.role)) {
    // franchise sees: admin_default, admin_franchise (for them),
    //   franchise_default (their own), franchise_merchant (their merchants)
    where[Op.or] = [
      { scope: 'admin_default' },
      { scope: 'admin_franchise', franchaise_id: req.user.id },
      { scope: 'franchise_default', franchaise_id: req.user.id },
      { scope: 'franchise_merchant', franchaise_id: req.user.id }
    ];
  } else if (req.user.role === 'merchant') {
    // merchant sees:
    //   * any rule explicitly tied to their user id (regardless of scope),
    //     this catches mis‑scoped records and avoids relying solely on the
    //     scoped branches below
    //   * admin defaults (global)
    //   * admin/franchise rules created for them
    const orConditions = [
      { user_id: req.user.id },
      { scope: 'admin_default' },
      { scope: 'admin_merchant', user_id: req.user.id }
    ];
    if (req.user.super_franchise_id) {
      orConditions.push({ scope: 'admin_super_franchise', super_franchise_id: req.user.super_franchise_id });
      orConditions.push({ scope: 'super_franchise_default', super_franchise_id: req.user.super_franchise_id });
      orConditions.push({ scope: 'super_franchise_merchant', user_id: req.user.id });
    }
    if (req.user.franchaise_id) {
      orConditions.push({ scope: 'admin_franchise', franchaise_id: req.user.franchaise_id });
      orConditions.push({ scope: 'franchise_default', franchaise_id: req.user.franchaise_id });
      orConditions.push({ scope: 'franchise_merchant', user_id: req.user.id });
    }
    where[Op.or] = orConditions;
  }

  const { count, rows } = await PosChargeRule.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset,
    order: [['createdAt', 'DESC']]
  });

  res.status(200).json({
    success: true,
    data: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / parseInt(limit))
    }
  });
});

// dedicated list endpoint for merchants - returns rules grouped by origin
const listMerchantChargeRules = asyncHandler(async (req, res) => {
  if (req.user.role !== 'merchant') {
    return res.status(403).json({ success: false, message: 'Only merchants may call this endpoint' });
  }

  const {
    payment_mode,
    card_type,
    card_brand,
    card_classification,
    settlement_type,
    is_active
  } = req.query;

  // common filter applied to every group (does not include user/franchise ids
  // because each group applies those separately)
  const baseFilter = {};
  if (payment_mode) baseFilter.payment_mode = payment_mode;
  if (card_type) baseFilter.card_type = card_type;
  if (card_brand) baseFilter.card_brand = card_brand;
  if (card_classification) baseFilter.card_classification = card_classification;
  if (settlement_type) baseFilter.settlement_type = settlement_type;
  if (is_active !== undefined) baseFilter.is_active = is_active === 'true' || is_active === true;

  const merchantId = req.user.id;

  // franchaise_id is NOT embedded in the JWT - look it up from the DB so we
  // always have the current value.
  const merchantRecord = await User.findByPk(merchantId, { attributes: ['franchaise_id'] });
  if (!merchantRecord) {
    return res.status(404).json({ success: false, message: 'Merchant not found' });
  }
  const franchiseId = merchantRecord.franchaise_id || null;

  // fetch all five groups in parallel
  const [adminDefault, adminFranchise, adminMerchant, franchiseDefault, franchiseMerchant] = await Promise.all([
    // 1. admin global defaults (no user, no franchise)
    PosChargeRule.findAll({
      where: { ...baseFilter, scope: 'admin_default' },
      order: [['createdAt', 'DESC']]
    }),

    // 1b. admin franchise-specific rules (visible to merchant if they belong to this franchise)
    franchiseId
      ? PosChargeRule.findAll({
          where: { ...baseFilter, scope: 'admin_franchise', franchaise_id: franchiseId },
          order: [['createdAt', 'DESC']]
        })
      : Promise.resolve([]),

    // 2. admin rules created specifically for this merchant
    PosChargeRule.findAll({
      where: { ...baseFilter, scope: 'admin_merchant', user_id: merchantId },
      order: [['createdAt', 'DESC']]
    }),

    // 3. franchise default rules (visible only if merchant belongs to a franchise)
    franchiseId
      ? PosChargeRule.findAll({
          where: { ...baseFilter, scope: 'franchise_default', franchaise_id: franchiseId },
          order: [['createdAt', 'DESC']]
        })
      : Promise.resolve([]),

    // 4. franchise rules created specifically for this merchant
    franchiseId
      ? PosChargeRule.findAll({
          where: { ...baseFilter, scope: 'franchise_merchant', user_id: merchantId, franchaise_id: franchiseId },
          order: [['createdAt', 'DESC']]
        })
      : Promise.resolve([])
  ]);

  res.status(200).json({
    success: true,
    data: {
      admin_default:     adminDefault,
      admin_franchise:   adminFranchise,
      admin_merchant:    adminMerchant,
      franchise_default: franchiseDefault,
      franchise_merchant: franchiseMerchant
    }
  });
});

// update rule
const updatePosChargeRule = asyncHandler(async (req, res) => {
  fileLog(`UPDATE request id=${req.params.id} body=${JSON.stringify(req.body)}`);
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: 'id required' });

  const rec = await PosChargeRule.findByPk(id);
  if (!rec) return res.status(404).json({ success: false, message: 'Rule not found' });

  // franchise users may only modify rules they created. treat null/absent
  // created_by as system-owned (not editable).
  if (req.user.role === 'franchaise' && rec.created_by !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Cannot modify rule created by another user' });
  }

  // pull fields early so we can validate them
  const {
    user_id,
    franchaise_id,
    super_franchise_id,
    payment_mode,
    card_type,
    card_brand,
    card_classification,
    settlement_type,
    min_amount,
    max_amount,
    gst_required,
    gst_percent,
    company_name
  } = req.body;

  const normalizedCardBrand = card_brand !== undefined ? normalizeCardBrand(card_brand) : undefined;
  const errs = validateRuleInput(req.body);
  if (franchaise_id !== undefined && franchaise_id !== null && isNaN(parseInt(franchaise_id, 10))) {
    errs.push('franchaise_id must be an integer');
  }
  if (super_franchise_id !== undefined && super_franchise_id !== null && isNaN(parseInt(super_franchise_id, 10))) {
    errs.push('super_franchise_id must be an integer');
  }
  if (errs.length) {
    return res.status(400).json({ success: false, errors: errs });
  }

  // if slab or identifiers changed, ensure not creating duplicate

  // determine effective franchise & super franchise for update
  let effectiveFranchise = franchaise_id !== undefined ? franchaise_id : rec.franchaise_id;
  let effectiveSuperFranchise = super_franchise_id !== undefined ? super_franchise_id : rec.super_franchise_id;

  if (req.user.role === 'super_franchise') {
    if (effectiveSuperFranchise && parseInt(effectiveSuperFranchise) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Cannot edit rule for another super franchise' });
    }
    effectiveSuperFranchise = req.user.id;
  }

  // admin update restriction: cannot target a merchant who has a franchise
  if (req.user.role === 'admin' && user_id) {
    const target = await User.findByPk(user_id);
    if (target && target.franchaise_id) {
      return res.status(400).json({ success: false, message: 'Cannot modify merchant-specific rule for a franchised merchant; use franchise rule' });
    }
  }
  if (isFranchiseRole(req.user.role)) {
    // franchise cannot edit a rule that targets themselves as a merchant
    if (user_id && parseInt(user_id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'Franchise cannot modify a rule for themselves' });
    }
    if (effectiveFranchise && parseInt(effectiveFranchise) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Cannot edit rule for another franchise' });
    }
    // if user_id belongs to a merchant verify ownership below
    effectiveFranchise = req.user.id;
  }

  // only perform duplicate/overlap check when any of the identity or slab fields are being changed
  const fieldsToCheck = [
    user_id,
    franchaise_id,
    super_franchise_id,
    payment_mode,
    card_type,
    card_brand,
    card_classification,
    settlement_type,
    min_amount,
    max_amount,
    gst_required,
    gst_percent,
    company_name
  ];

  // derive scope early so we can use it in duplicate/overlap checks
  const updCallerRole = isFranchiseRole(req.user.role) ? 'franchaise' : req.user.role;
  const updUserId = user_id !== undefined ? user_id || null : rec.user_id;
  const updScope = deriveScope(updCallerRole, updUserId, effectiveFranchise, effectiveSuperFranchise);

  const shouldValidateSlab = fieldsToCheck.some(val => val !== undefined);
  if (shouldValidateSlab) {
    const dup = await PosChargeRule.findOne({
      where: {
        id: { [Op.ne]: id },
        user_id: user_id !== undefined ? user_id || null : rec.user_id,
        franchaise_id: effectiveFranchise,
        scope: updScope,
        payment_mode: payment_mode !== undefined ? payment_mode || null : rec.payment_mode,
        card_type: card_type !== undefined ? card_type || null : rec.card_type,
        card_brand: normalizedCardBrand !== undefined ? normalizedCardBrand || null : rec.card_brand,
        card_classification: card_classification !== undefined ? card_classification || null : rec.card_classification,
        settlement_type: settlement_type !== undefined ? settlement_type || null : rec.settlement_type,
        company_name: company_name !== undefined ? company_name || null : rec.company_name,
        min_amount: min_amount !== undefined ? min_amount : rec.min_amount,
        max_amount: max_amount !== undefined ? max_amount || null : rec.max_amount
      }
    });
    if (dup) {
      return res.status(400).json({ success: false, message: 'Another rule with same parameters already exists' });
    }

    // also check overlapping slabs when amounts or identifying fields change
    const checkMin = min_amount !== undefined ? parseDecimal(min_amount) || 0 : parseDecimal(rec.min_amount) || 0;
    const checkMaxVal = max_amount !== undefined ? parseDecimal(max_amount) : rec.max_amount;
    const checkMax = checkMaxVal != null ? checkMaxVal : null;
    const overlapCondition = {
      user_id: user_id !== undefined ? user_id || null : rec.user_id,
      franchaise_id: effectiveFranchise,
      scope: updScope,
      payment_mode: payment_mode !== undefined ? payment_mode || null : rec.payment_mode,
      card_type: card_type !== undefined ? card_type || null : rec.card_type,
      card_brand: normalizedCardBrand !== undefined ? normalizedCardBrand || null : rec.card_brand,
      card_classification: card_classification !== undefined ? card_classification || null : rec.card_classification,
      settlement_type: settlement_type !== undefined ? settlement_type || null : rec.settlement_type,
      company_name: company_name !== undefined ? company_name || null : rec.company_name
    };
    const existingSlabs = await PosChargeRule.findAll({
      where: {
        ...overlapCondition,
        id: { [Op.ne]: id }
      }
    });
    const hasOverlap = existingSlabs.some((slab) => {
      const slabMin = slab.min_amount != null ? parseFloat(slab.min_amount) : 0;
      const slabMax = slab.max_amount != null ? parseFloat(slab.max_amount) : Infinity;
      const m1 = checkMin;
      const m2 = checkMax != null ? checkMax : Infinity;
      return m1 <= slabMax && m2 >= slabMin;
    });
    if (hasOverlap) {
      return res.status(400).json({
        success: false,
        message: 'Amount slab overlaps with an existing rule in the same category'
      });
    }
  }

  // explicitly pick gst fields for safety
  const updateData = { ...req.body };
  // enforce franchise ownership on explicit field
  if (req.user.role === 'franchaise') {
    updateData.franchaise_id = req.user.id;
  }
  // apply pre-computed scope
  updateData.scope = updScope;
  if (normalizedCardBrand !== undefined) updateData.card_brand = normalizedCardBrand || null;
  if (req.body.gst_required !== undefined) updateData.gst_required = Boolean(req.body.gst_required);
  if (req.body.gst_percent !== undefined) updateData.gst_percent = req.body.gst_percent;
  if (req.body.company_name !== undefined) updateData.company_name = req.body.company_name || null;
  await rec.update(updateData);
  fileLog(`UPDATE success id=${rec.id}`);
  res.status(200).json({ success: true, message: 'Rule updated', record: rec });
});

// delete ALL user-specific rules across all users (admin only)
const deleteAllUserSpecificRules = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Only admin may call this endpoint' });
  }

  // deletes every rule scoped to an individual user (admin_merchant + franchise_merchant)
  // leaving global / franchise-level rules (admin_default, admin_franchise, franchise_default) intact
  const deleted = await PosChargeRule.destroy({
    where: {
      scope: { [Op.in]: ['admin_merchant', 'franchise_merchant'] }
    }
  });

  res.status(200).json({ success: true, message: `Deleted ${deleted} user-specific rule(s)`, deleted });
});

// delete rule
const deletePosChargeRule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: 'id required' });

  const rec = await PosChargeRule.findByPk(id);
  if (!rec) return res.status(404).json({ success: false, message: 'Rule not found' });

  // franchise may only delete their own rules or those for their merchants
  if (req.user.role === 'franchaise') {
    if (rec.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Cannot delete rule created by another user' });
    }
    if (rec.franchaise_id && parseInt(rec.franchaise_id) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Cannot delete rule for another franchise' });
    }
    if (rec.user_id) {
      const target = await User.findByPk(rec.user_id);
      if (!target || String(target.franchaise_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Cannot delete merchant rule that is not yours' });
      }
    }
  }

  await rec.destroy();
  res.status(200).json({ success: true, message: 'Rule deleted' });
});

// calculate charge
const calculateCharge = asyncHandler(async (req, res) => {
  fileLog(`CALCULATE request body: ${JSON.stringify(req.body)}`);
  const {
    user_id,
    payment_mode,
    card_type,
    card_brand,
    card_classification,
    settlement_type,
    amount
  } = req.body;

  if (amount === undefined || amount === null) {
    fileLog('CALCULATE missing amount');
    return res.status(400).json({ success: false, message: 'amount is required' });
  }

  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < 0) {
    fileLog(`CALCULATE invalid amount: ${amt}`);
    return res.status(400).json({ success: false, message: 'amount must be a non-negative number' });
  }

  // determine franchise id if not explicitly supplied
  let franchiseId = req.body.franchaise_id;
  if (!franchiseId && user_id) {
    const u = await User.findByPk(user_id);
    if (u) franchiseId = u.franchaise_id;
  }

  let rule = await ChargeService.getTransactionChargeRule({
    userId: user_id,
    userRole: user.role,
    franchiseId,
    paymentMode: payment_mode,
    cardType: card_type,
    cardBrand: card_brand,
    classification: card_classification,
    settlement: settlement_type,
    amount: amt
  });

  const DEFAULT_MDR = 2.5;
  if (!rule) {
    // fallback
    rule = { charge_percent: DEFAULT_MDR, charge_flat: 0 };
  }

  const { charge: chargeAmt, gstAmount } = ChargeService.calculateCharge(amt, rule);
  const merchantSettlement = parseFloat((amt - chargeAmt - gstAmount).toFixed(2));

  fileLog(`CALCULATE result ruleId=${rule && rule.id ? rule.id : 'fallback'} charge=${chargeAmt} gst=${gstAmount}`);

  res.status(200).json({
    success: true,
    rule,
    charge_percent: parseFloat(rule.charge_percent),
    charge_amount: chargeAmt,
    gst_amount: gstAmount,
    merchant_settlement: merchantSettlement
  });
});

module.exports = {
  createPosChargeRule,
  getPosChargeRule,
  listPosChargeRules,
  listMerchantChargeRules,
  listFranchiseAdminRules,
  listFranchiseCustomRules,
  updatePosChargeRule,
  deletePosChargeRule,
  deleteAllUserSpecificRules,
  calculateCharge
};

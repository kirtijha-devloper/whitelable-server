const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const PosChargeDefault = require('../models/PosChargeDefault');
const UserPosCharge = require('../models/UserPosCharge');
const User = require('../models/User');
const PosGlobalRate = require('../models/PosGlobalRate');
const RazorpayNotification = require('../models/RazorpayNotification');
const Sequelize = require('sequelize');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve the effective fee from a charge record and an optional transaction amount.
 * Business rule: if both flat_fee and percent_fee are set, percent takes precedence.
 */
function computeFee(charge, amount) {
  if (!charge) return null;
  const amt = parseFloat(amount || 0);
  const percent = charge.percent_fee ? parseFloat(charge.percent_fee) : 0;
  const fee = parseFloat(((percent / 100) * amt).toFixed(2));
  return { percent_fee: percent, fee };
}

/**
 * Pick the most specific charge record from a list using a scoring approach.
 * Scoring: brand = 4, card_type = 2, mode = 1 — explicit match adds points, mismatch deducts.
 */
function pickMostSpecific(records, search) {
  if (!records || records.length === 0) return null;

  const scoreFor = (r) => {
    let s = 0;
    if (r.payment_card_brand) {
      if (search.paymentCardBrand && r.payment_card_brand.toUpperCase() === search.paymentCardBrand.toUpperCase()) s += 4;
      else s -= 1;
    }
    if (r.payment_card_type) {
      if (search.paymentCardType && r.payment_card_type.toUpperCase() === search.paymentCardType.toUpperCase()) s += 2;
      else s -= 1;
    }
    if (r.payment_mode) {
      if (search.paymentMode && r.payment_mode.toUpperCase() === search.paymentMode.toUpperCase()) s += 1;
      else s -= 1;
    }
    return s;
  };

  let best = null;
  let bestScore = -Infinity;
  for (const r of records) {
    const sc = scoreFor(r);
    if (sc > bestScore) {
      bestScore = sc;
      best = r;
    }
  }
  return best;
}

/**
 * Assert that the requesting franchaise owns the target merchant.
 * Throws 403 if the check fails.
 */
async function assertFranchaiseOwnsMerchant(franchaise_id, merchant_id, res) {
  const merchant = await User.findOne({
    where: { id: merchant_id, role: 'merchant', franchaise_id }
  });
  if (!merchant) {
    res.status(403);
    throw new Error('Access denied: merchant does not belong to your franchise');
  }
  return merchant;
}

// ─── Default POS Charge (Admin only for write) ───────────────────────────────

/** POST /api/pos-charge/default — admin only */
const createDefaultPosCharge = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }

  const { paymentMode, paymentCardType, paymentCardBrand, percent_fee, is_active } = req.body;

  if (!percent_fee || parseFloat(percent_fee) === 0) {
    res.status(400);
    throw new Error('percent_fee must be provided and non-zero');
  }

  const percentVal = parseFloat(percent_fee);

  // Check for duplicate combination
  const existing = await PosChargeDefault.findOne({
    where: {
      payment_mode: paymentMode || null,
      payment_card_type: paymentCardType || null,
      payment_card_brand: paymentCardBrand || null
    }
  });
  if (existing) {
    res.status(400);
    throw new Error('A default POS charge for this combination already exists');
  }

  const record = await PosChargeDefault.create({
    payment_mode: paymentMode || null,
    payment_card_type: paymentCardType || null,
    payment_card_brand: paymentCardBrand || null,
    percent_fee: percentVal,
    is_active: typeof is_active === 'boolean' ? is_active : true,
    created_by: req.user.id
  });

  res.status(201).json({ message: 'Default POS charge created', record });
});

/** GET /api/pos-charge/default — all authenticated roles */
const getDefaultPosCharges = asyncHandler(async (req, res) => {
  const records = await PosChargeDefault.findAll({ order: [['createdAt', 'DESC']] });
  res.status(200).json(records);
});

/** PUT /api/pos-charge/default/:id — admin only */
const updateDefaultPosCharge = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }

  const rec = await PosChargeDefault.findByPk(req.params.id);
  if (!rec) {
    res.status(404);
    throw new Error('Default POS charge not found');
  }

  const { paymentMode, paymentCardType, paymentCardBrand, percent_fee, is_active } = req.body;

  const finalPercent = percent_fee !== undefined ? parseFloat(percent_fee || 0) : parseFloat(rec.percent_fee || 0);

  // Check for duplicate combination if keys are changing
  const newMode = paymentMode !== undefined ? (paymentMode || null) : rec.payment_mode;
  const newType = paymentCardType !== undefined ? (paymentCardType || null) : rec.payment_card_type;
  const newBrand = paymentCardBrand !== undefined ? (paymentCardBrand || null) : rec.payment_card_brand;

  const duplicate = await PosChargeDefault.findOne({
    where: {
      payment_mode: newMode,
      payment_card_type: newType,
      payment_card_brand: newBrand,
      id: { [Op.ne]: rec.id }
    }
  });
  if (duplicate) {
    res.status(400);
    throw new Error('Another default POS charge for this combination already exists');
  }

  await rec.update({
    payment_mode: newMode,
    payment_card_type: newType,
    payment_card_brand: newBrand,
    percent_fee: finalPercent,
    ...(typeof is_active === 'boolean' && { is_active })
  });

  res.status(200).json({ message: 'Updated', record: rec });
});

/** DELETE /api/pos-charge/default/:id — admin only */
const deleteDefaultPosCharge = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }

  const rec = await PosChargeDefault.findByPk(req.params.id);
  if (!rec) {
    res.status(404);
    throw new Error('Default POS charge not found');
  }

  await rec.destroy();
  res.status(200).json({ message: 'Deleted' });
});

// ─── User-specific POS Charge ─────────────────────────────────────────────────

/**
 * POST /api/pos-charge/user
 * - admin: can set for any user, optionally creating the default entry inline
 * - franchaise: can set for their own merchants only; must reference existing pos_charge_default_id
 */
const createUserPosCharge = asyncHandler(async (req, res) => {
  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  const role = req.user.role;
  if (!['admin', 'franchaise'].includes(role)) {
    res.status(403);
    throw new Error('Access denied');
  }

  const {
    user_id,
    pos_charge_default_id,
    paymentMode,
    paymentCardType,
    paymentCardBrand,
    percent_fee,
    is_active
  } = req.body;

  if (!user_id) {
    res.status(400);
    throw new Error('user_id is required');
  }

  const targetUser = await User.findByPk(user_id);
  if (!targetUser) {
    res.status(404);
    throw new Error('User not found');
  }

  // Franchaise can only set charges for their own merchants
  if (role === 'franchaise') {
    if (targetUser.role !== 'merchant' || String(targetUser.franchaise_id) !== String(req.user.id)) {
      res.status(403);
      throw new Error('Access denied: merchant does not belong to your franchise');
    }
    if (!pos_charge_default_id) {
      res.status(400);
      throw new Error('pos_charge_default_id is required for franchise');
    }
  }

  let defaultRecord = null;

  if (pos_charge_default_id) {
    defaultRecord = await PosChargeDefault.findByPk(pos_charge_default_id);
    if (!defaultRecord) {
      res.status(404);
      throw new Error('PosChargeDefault not found');
    }
  } else {
    // Admin-only: create default inline if not provided
    if (!percent_fee || parseFloat(percent_fee) === 0) {
      res.status(400);
      throw new Error('Either pos_charge_default_id or a non-zero percent_fee is required');
    }

    const percentVal = parseFloat(percent_fee);

    // Re-use existing default if exact combination exists, otherwise create
    defaultRecord = await PosChargeDefault.findOne({
      where: {
        payment_mode: paymentMode || null,
        payment_card_type: paymentCardType || null,
        payment_card_brand: paymentCardBrand || null
      }
    });

    if (!defaultRecord) {
      defaultRecord = await PosChargeDefault.create({
        payment_mode: paymentMode || null,
        payment_card_type: paymentCardType || null,
        payment_card_brand: paymentCardBrand || null,
        percent_fee: percentVal,
        is_active: true,
        created_by: req.user.id
      });
    }
  }

  // Prevent duplicate links
  const existingLink = await UserPosCharge.findOne({
    where: { user_id, pos_charge_default_id: defaultRecord.id }
  });
  if (existingLink) {
    res.status(400);
    throw new Error('User already has this POS charge configuration linked');
  }

  // Optional per-user percent_fee override; NULL = use the default's value
  const overridePercent = (pos_charge_default_id && percent_fee !== undefined && percent_fee !== null)
    ? parseFloat(percent_fee)
    : null;

  const link = await UserPosCharge.create({
    user_id,
    pos_charge_default_id: defaultRecord.id,
    percent_fee: overridePercent,
    is_active: typeof is_active === 'boolean' ? is_active : true,
    created_by: req.user.id,
    company_id : companyId,
  });

  res.status(201).json({ message: 'User POS charge linked', link, defaultPosCharge: defaultRecord });
});

/**
 * GET /api/pos-charge/user
 * - admin: pass ?user_id= or see all
 * - franchaise: pass ?user_id= (must belong to their franchise); without user_id, lists all their merchants
 * - merchant: always sees only their own
 */
const getUserPosCharges = asyncHandler(async (req, res) => {
  const role = req.user.role;
  let where = {};

  if (role === 'merchant') {
    where.user_id = req.user.id;
  } else if (role === 'franchaise') {
    const { user_id } = req.query;
    if (user_id) {
      await assertFranchaiseOwnsMerchant(req.user.id, user_id, res);
      where.user_id = user_id;
    } else {
      // All merchants under this franchise
      const myMerchants = await User.findAll({
        where: { role: 'merchant', franchaise_id: req.user.id },
        attributes: ['id']
      });
      const merchantIds = myMerchants.map(m => m.id);
      where.user_id = { [Op.in]: merchantIds };
    }
  } else if (role === 'admin') {
    if (req.query.user_id) where.user_id = req.query.user_id;
  } else {
    res.status(403);
    throw new Error('Access denied');
  }

  const records = await UserPosCharge.findAll({
    where,
    attributes: ['id', 'user_id', 'pos_charge_default_id', 'percent_fee', 'is_active', 'created_by', 'createdAt', 'updatedAt'],
    include: [
      {
        model: PosChargeDefault,
        as: 'defaultPosCharge',
        attributes: ['id', 'payment_mode', 'payment_card_type', 'payment_card_brand', 'percent_fee', 'is_active']
      }
    ],
    order: [['createdAt', 'DESC']],
    raw: true,
    nest: true
  });

  res.status(200).json(records);
});

/**
 * PUT /api/pos-charge/user/:id
 * - admin: can update any
 * - franchaise: can update only for their merchants
 */
const updateUserPosCharge = asyncHandler(async (req, res) => {
  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  const role = req.user.role;
  if (!['admin', 'franchaise'].includes(role)) {
    res.status(403);
    throw new Error('Access denied');
  }

  const rec = await UserPosCharge.findByPk(req.params.id);
  if (!rec) {
    res.status(404);
    throw new Error('User POS charge not found');
  }

  // Franchaise ownership check
  if (role === 'franchaise') {
    await assertFranchaiseOwnsMerchant(req.user.id, rec.user_id, res);
  }

  const { pos_charge_default_id, percent_fee, is_active } = req.body;

  if (pos_charge_default_id) {
    const dd = await PosChargeDefault.findByPk(pos_charge_default_id);
    if (!dd) {
      res.status(404);
      throw new Error('PosChargeDefault not found');
    }
    rec.pos_charge_default_id = dd.id;
  }

  if (percent_fee !== undefined) {
    rec.percent_fee = percent_fee;
  }

  if (typeof is_active === 'boolean') rec.is_active = is_active;

  rec.company_id = companyId;
  await rec.save();

  const updated = await UserPosCharge.findByPk(rec.id, {
    include: [{ model: PosChargeDefault, as: 'defaultPosCharge' }]
  });
  res.status(200).json({ message: 'Updated', record: updated });
});

/**
 * DELETE /api/pos-charge/user/:id
 * - admin: can delete any
 * - franchaise: can delete only for their merchants
 */
const deleteUserPosCharge = asyncHandler(async (req, res) => {
  const role = req.user.role;
  if (!['admin', 'franchaise'].includes(role)) {
    res.status(403);
    throw new Error('Access denied');
  }

  const rec = await UserPosCharge.findByPk(req.params.id);
  if (!rec) {
    res.status(404);
    throw new Error('User POS charge not found');
  }

  if (role === 'franchaise') {
    await assertFranchaiseOwnsMerchant(req.user.id, rec.user_id, res);
  }

  await rec.destroy();
  res.status(200).json({ message: 'Deleted' });
});

// ─── Calculate Effective POS Charge ──────────────────────────────────────────

/**
 * POST /api/pos-charge/calculate
 * Body: { paymentMode, paymentCardType, paymentCardBrand, amount?, user_id? }
 * Returns the effective POS charge for the given combination.
 * Resolution order: user-specific → global default.
 * All authenticated roles may use this endpoint.
 */
const calculatePosCharge = asyncHandler(async (req, res) => {
  const { paymentMode, paymentCardType, paymentCardBrand, amount } = req.body;

  // Determine which user to look up
  let targetUserId = req.body.user_id || null;
  const role = req.user.role;

  if (role === 'merchant') {
    targetUserId = req.user.id; // merchants always resolve against themselves
  } else if (role === 'franchaise' && targetUserId) {
    // Verify ownership
    await assertFranchaiseOwnsMerchant(req.user.id, targetUserId, res);
  }

  const search = { paymentMode, paymentCardType, paymentCardBrand };

  // Build flexible WHERE for matching (NULL columns act as wildcards)
  const buildWhere = () => ({
    [Op.and]: [
      { [Op.or]: [{ payment_mode: paymentMode || null }, { payment_mode: null }] },
      { [Op.or]: [{ payment_card_type: paymentCardType || null }, { payment_card_type: null }] },
      { [Op.or]: [{ payment_card_brand: paymentCardBrand || null }, { payment_card_brand: null }] }
    ]
  });

  // 1) User-specific lookup
  if (targetUserId) {
    const userLinks = await UserPosCharge.findAll({
      where: { user_id: targetUserId, is_active: true },
      include: [{ model: PosChargeDefault, as: 'defaultPosCharge' }]
    });

    // Merge user-level overrides into the default record
    const candidates = userLinks
      .map(link => {
        const def = link.defaultPosCharge;
        if (!def) return null;
        const base = def.get ? def.get({ plain: true }) : { ...def };
        if (link.percent_fee !== null && link.percent_fee !== undefined) base.percent_fee = link.percent_fee;
        return base;
      })
      .filter(Boolean);

    const best = pickMostSpecific(candidates, search);
    if (best && best.is_active) {
      const feeInfo = amount !== undefined && amount !== null ? computeFee(best, amount) : null;
      return res.status(200).json({ source: 'user', charge: best, fee: feeInfo });
    }
  }

  // 2) Global default fallback
  const defaultRecords = await PosChargeDefault.findAll({
    where: { ...buildWhere(), is_active: true }
  });
  const bestDefault = pickMostSpecific(defaultRecords, search);

  if (bestDefault) {
    const feeInfo = amount !== undefined && amount !== null ? computeFee(bestDefault, amount) : null;
    return res.status(200).json({ source: 'default', charge: bestDefault, fee: feeInfo });
  }

  res.status(404).json({ message: 'No POS charge configuration found for the given combination' });
});

// ─── Razorpay notification value helpers ─────────────────────────────────────

/**
 * GET /api/pos-charge/razorpay-options
 * Returns distinct values for payment_mode, payment_card_type and
 * payment_card_brand present in razorpay_notifications.  Useful for
 * populating admin filters or dropdowns on the front end.
 * All authenticated roles may access this.
 */
const getRazorpayOptions = asyncHandler(async (req, res) => {
  // perform three independent distinct queries and dedupe nulls
  const [modes, types, brands] = await Promise.all([
    RazorpayNotification.findAll({
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('payment_mode')), 'payment_mode']],
      where: { payment_mode: { [Op.ne]: null } },
      raw: true
    }),
    RazorpayNotification.findAll({
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('payment_card_type')), 'payment_card_type']],
      where: { payment_card_type: { [Op.ne]: null } },
      raw: true
    }),
    RazorpayNotification.findAll({
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('payment_card_brand')), 'payment_card_brand']],
      where: { payment_card_brand: { [Op.ne]: null } },
      raw: true
    })
  ]);

  res.status(200).json({
    payment_modes: modes.map(m => m.payment_mode),
    payment_card_types: types.map(t => t.payment_card_type),
    payment_card_brands: brands.map(b => b.payment_card_brand)
  });
});

// ─── Global POS Rate (single fallback row, admin write) ──────────────────────

/**
 * POST /api/pos-charge/global-rate
 * Upserts the single global fallback POS rate.
 * Admin only.
 */
const setGlobalPosRate = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }

  const { percent_fee, is_active } = req.body;

  if (percent_fee === undefined || percent_fee === null) {
    res.status(400);
    throw new Error('percent_fee is required');
  }

  const percentVal = parseFloat(percent_fee);
  if (isNaN(percentVal) || percentVal < 0) {
    res.status(400);
    throw new Error('percent_fee must be a non-negative number');
  }

  // Always operate on the single row (id = 1)
  const [record, created] = await PosGlobalRate.upsert(
    {
      id: 1,
      percent_fee: percentVal,
      is_active: typeof is_active === 'boolean' ? is_active : true,
      updated_by: req.user.id
    },
    { returning: true }
  );

  const statusCode = created ? 201 : 200;
  res.status(statusCode).json({
    message: created ? 'Global POS rate created' : 'Global POS rate updated',
    record: record || (await PosGlobalRate.findByPk(1))
  });
});

/**
 * GET /api/pos-charge/global-rate
 * Returns the current global fallback POS rate.
 * All authenticated roles.
 */
const getGlobalPosRate = asyncHandler(async (req, res) => {
  const record = await PosGlobalRate.findByPk(1);
  if (!record) {
    return res.status(404).json({ message: 'Global POS rate not configured yet' });
  }
  res.status(200).json(record);
});

module.exports = {
  createDefaultPosCharge,
  getDefaultPosCharges,
  updateDefaultPosCharge,
  deleteDefaultPosCharge,
  createUserPosCharge,
  getUserPosCharges,
  updateUserPosCharge,
  deleteUserPosCharge,
  calculatePosCharge,
  setGlobalPosRate,
  getGlobalPosRate,
  getRazorpayOptions,
  // exported for testing / worker
  computeFee,
  pickMostSpecific
};

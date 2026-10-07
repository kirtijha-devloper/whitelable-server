const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const CommissionDefault = require('../models/CommissionDefault');
const UserCommission = require('../models/UserCommission');
const User = require('../models/User');

// Helper: compute fee from commission config and amount
// Business rule: ONLY one method applies — percentage OR flat. If both are present, percentage takes precedence.
function computeFee(commission, amount) {
  if (!commission) return null;
  const amt = parseFloat(amount || 0);
  const flat = commission.flat_fee ? parseFloat(commission.flat_fee) : 0;
  const percent = commission.percent_fee ? parseFloat(commission.percent_fee) : 0;

  // If percentage is specified (>0) use it (takes precedence if both present)
  if (percent > 0) {
    const charge = parseFloat(((percent / 100) * amt).toFixed(2));
    return { flat_fee: 0, percent_fee: percent, charge };
  }

  // Otherwise use flat fee (may be 0)
  const charge = parseFloat((flat || 0).toFixed(2));
  return { flat_fee: flat, percent_fee: 0, charge };
}

// Choose the most specific match from an array of commission records (supports optional amount-based slab matching)
function pickMostSpecific(records, search, amount) {
  if (!records || records.length === 0) return null;

  // If amount provided, prefer records whose min/max include the amount.
  let candidates = records;
  if (amount !== undefined && amount !== null) {
    const amt = parseFloat(amount);
    const matchedByAmount = records.filter(r => {
      const min = r.min_amount !== null && r.min_amount !== undefined ? parseFloat(r.min_amount) : 0;
      const max = r.max_amount !== null && r.max_amount !== undefined ? parseFloat(r.max_amount) : Infinity;
      return amt >= min && amt <= max;
    });
    if (matchedByAmount.length) candidates = matchedByAmount;
  }

  // scoring weights: brand=4, type=2, mode=1
  const scoreFor = (r) => {
    let s = 0;
      if (r.payment_card_brand) {
      if (search.paymentCardBrand && r.payment_card_brand.toUpperCase() === search.paymentCardBrand.toUpperCase()) s += 4;
      else s -= 1; // penalize explicit mismatch so wildcard wins
    }
    if (r.payment_card_type) {
      if (search.paymentCardType && r.payment_card_type.toUpperCase() === search.paymentCardType.toUpperCase()) s += 2;
      else s -= 1;
    }
    if (r.payment_mode) {
      if (search.paymentMode && r.payment_mode.toUpperCase() === search.paymentMode.toUpperCase()) s += 1;
      else s -= 1;
    }
    // prefer narrower slabs when amount is provided
    if (amount !== undefined && amount !== null && r.min_amount != null && r.max_amount != null) {
      const range = Math.max(0, parseFloat(r.max_amount) - parseFloat(r.min_amount));
      // small heuristic: narrower range -> higher score
      s += Math.max(0, Math.floor((1 / (range + 1)) * 10));
    }
    return s;
  };

  let best = null;
  let bestScore = -1;
  for (const r of candidates) {
    const sc = scoreFor(r);
    if (sc > bestScore) {
      bestScore = sc;
      best = r;
    }
  }
  return best;
}

// Public: create default commission (admin only)
const createDefaultCommission = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }

  const { paymentCardBrand, paymentCardType, paymentMode, min_amount, max_amount, flat_fee, percent_fee, is_active } = req.body;

  if ((!flat_fee || parseFloat(flat_fee) === 0) && (!percent_fee || parseFloat(percent_fee) === 0)) {
    res.status(400);
    throw new Error('At least one of flat_fee or percent_fee must be provided');
  }

  // Business rule: only one of flat_fee OR percent_fee may be non-zero for a slab
  const flatVal = flat_fee ? parseFloat(flat_fee) : 0;
  const percentVal = percent_fee ? parseFloat(percent_fee) : 0;
  if (flatVal > 0 && percentVal > 0) {
    res.status(400);
    throw new Error('Only one of flat_fee or percent_fee can be non-zero for a commission slab');
  }

  const newMin = min_amount !== undefined && min_amount !== null ? parseFloat(min_amount) : 0;
  const newMax = max_amount !== undefined && max_amount !== null ? parseFloat(max_amount) : Infinity;
  if (newMin > newMax) {
    res.status(400);
    throw new Error('min_amount cannot be greater than max_amount');
  }

  // Check for overlapping slabs for the same brand/type/mode
  const existingSlabs = await CommissionDefault.findAll({
    where: {
      payment_card_brand: paymentCardBrand || null,
      payment_card_type: paymentCardType || null,
      payment_mode: paymentMode || null
    }
  });

  const isOverlapping = existingSlabs.some((slab) => {
    const slabMin = slab.min_amount !== null && slab.min_amount !== undefined ? parseFloat(slab.min_amount) : 0;
    const slabMax = slab.max_amount !== null && slab.max_amount !== undefined ? parseFloat(slab.max_amount) : Infinity;
    return (newMin <= slabMax && newMax >= slabMin);
  });

  if (isOverlapping) {
    res.status(400);
    throw new Error('Overlapping commission slab exists for this combination');
  }

  const record = await CommissionDefault.create({
    payment_card_brand: paymentCardBrand || null,
    payment_card_type: paymentCardType || null,
    payment_mode: paymentMode || null,
    min_amount: min_amount || null,
    max_amount: max_amount || null,
    flat_fee: flat_fee || 0,
    percent_fee: percent_fee || 0,
    is_active: typeof is_active === 'boolean' ? is_active : true,
    created_by: req.user.id
  });

  res.status(201).json({ message: 'Default commission created', record });
});

// Create user-specific commission by referencing an existing default (preferred) or by creating a new default and linking it
const createUserCommission = asyncHandler(async (req, res) => {
  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }

  const { user_id, commission_default_id, paymentCardBrand, paymentCardType, paymentMode, min_amount, max_amount, flat_fee, percent_fee, is_active } = req.body;

  if (!user_id) {
    res.status(400);
    throw new Error('user_id is required');
  }

  const user = await User.findByPk(user_id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  let defaultRecord = null;

  // If caller provided an existing commission_default_id, link it
  if (commission_default_id) {
    defaultRecord = await CommissionDefault.findByPk(commission_default_id);
    if (!defaultRecord) {
      res.status(404);
      throw new Error('CommissionDefault not found');
    }
  } else {
    // Otherwise require commission details (or slab) to create a new CommissionDefault and then link it
    if ((!flat_fee || parseFloat(flat_fee) === 0) && (!percent_fee || parseFloat(percent_fee) === 0)) {
      res.status(400);
      throw new Error('Either commission_default_id or commission details (flat_fee/percent_fee) must be provided');
    }

    // Business rule: only one of flat_fee OR percent_fee may be non-zero for a slab
    const flatVal = flat_fee ? parseFloat(flat_fee) : 0;
    const percentVal = percent_fee ? parseFloat(percent_fee) : 0;
    if (flatVal > 0 && percentVal > 0) {
      res.status(400);
      throw new Error('Only one of flat_fee or percent_fee can be non-zero for a commission slab');
    }

    const newMin = min_amount !== undefined && min_amount !== null ? parseFloat(min_amount) : 0;
    const newMax = max_amount !== undefined && max_amount !== null ? parseFloat(max_amount) : Infinity;
    if (newMin > newMax) {
      res.status(400);
      throw new Error('min_amount cannot be greater than max_amount');
    }

    // Try to find exact slab (brand/type/mode + min/max)
    defaultRecord = await CommissionDefault.findOne({
      where: {
        payment_card_brand: paymentCardBrand || null,
        payment_card_type: paymentCardType || null,
        payment_mode: paymentMode || null,
        min_amount: min_amount || null,
        max_amount: max_amount || null
      }
    });

    // If exact slab not found, ensure it doesn't overlap existing slabs then create
    if (!defaultRecord) {
      const existingSlabs = await CommissionDefault.findAll({
        where: {
          payment_card_brand: paymentCardBrand || null,
          payment_card_type: paymentCardType || null,
          payment_mode: paymentMode || null
        }
      });

      const isOverlapping = existingSlabs.some((slab) => {
        const slabMin = slab.min_amount !== null && slab.min_amount !== undefined ? parseFloat(slab.min_amount) : 0;
        const slabMax = slab.max_amount !== null && slab.max_amount !== undefined ? parseFloat(slab.max_amount) : Infinity;
        return (newMin <= slabMax && newMax >= slabMin);
      });

      if (isOverlapping) {
        res.status(400);
        throw new Error('Overlapping commission slab exists for this combination');
      }

      defaultRecord = await CommissionDefault.create({
        payment_card_brand: paymentCardBrand || null,
        payment_card_type: paymentCardType || null,
        payment_mode: paymentMode || null,
        min_amount: min_amount || null,
        max_amount: max_amount || null,
        flat_fee: flat_fee || 0,
        percent_fee: percent_fee || 0,
        is_active: typeof is_active === 'boolean' ? is_active : true,
        created_by: req.user.id
      });
    }
  }

  // Ensure user doesn't already have this default linked
  const existingLink = await UserCommission.findOne({ where: { user_id, commission_default_id: defaultRecord.id } });
  if (existingLink) {
    res.status(400);
    throw new Error('User already has this commission configuration linked');
  }

  // validate user-specific override (if provided)
  const userFlat = flat_fee !== undefined && flat_fee !== null ? parseFloat(flat_fee) : null;
  const userPercent = percent_fee !== undefined && percent_fee !== null ? parseFloat(percent_fee) : null;
  if (userFlat > 0 && userPercent > 0) {
    res.status(400);
    throw new Error('Only one of flat_fee or percent_fee can be non-zero for a user commission');
  }

  const link = await UserCommission.create({
    user_id,
    commission_default_id: defaultRecord.id,
    flat_fee: userFlat,
    percent_fee: userPercent,
    is_active: true,
    created_by: req.user.id,
    company_id : companyId,
  });

  res.status(201).json({ message: 'User commission linked', link, commission: defaultRecord });
});

// List defaults (admin)
const getDefaultCommissions = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }
  const records = await CommissionDefault.findAll({ order: [['createdAt', 'DESC']] });
  res.status(200).json(records);
});

// List user commissions (admin or for the user) — returns the linked CommissionDefault with each link
const getUserCommissions = asyncHandler(async (req, res) => {
  console.log('getUserCommissions called', { query: req.query, authUserId: req.user && req.user.id });

  const { user_id } = req.query;

  if (!user_id && req.user.role !== 'admin') {
    req.query.user_id = req.user.id;
  }
  const targetUserId = user_id || req.user.id;

  // keep result lightweight and avoid Sequelize instance/circular serialization overhead
  // include user-specific override columns so we can prefer them over defaults when present
  const userCommissionAttrs = ['id', 'user_id', 'commission_default_id', 'flat_fee', 'percent_fee', 'is_active', 'created_by', 'createdAt', 'updatedAt'];
  const commissionDefaultAttrs = ['id', 'payment_card_brand', 'payment_card_type', 'payment_mode', 'min_amount', 'max_amount', 'flat_fee', 'percent_fee', 'is_active'];

  try {
    // quick DB health check — fast and should always return immediately
    const cnt = await UserCommission.count({ where: { user_id: targetUserId } });
    // allow quick test without the association (use ?_noInclude=1)
    if (req.query._noInclude === '1') {
      console.time('UserCommission.findAll.noInclude');
      const rows = await UserCommission.findAll({
        where: { user_id: targetUserId },
        attributes: userCommissionAttrs,
        order: [['createdAt', 'DESC']],
        raw: true,
        nest: true
      });
      console.timeEnd('UserCommission.findAll.noInclude');
      return res.status(200).json(rows);
    }

    console.time('UserCommission.findAll.withInclude');
    const records = await UserCommission.findAll({
      where: { user_id: targetUserId },
      attributes: userCommissionAttrs,
      include: [{ model: CommissionDefault, as: 'defaultCommission', attributes: commissionDefaultAttrs }],
      order: [['createdAt', 'DESC']],
      raw: true,
      nest: true
    });
    console.timeEnd('UserCommission.findAll.withInclude');

    // Flatten the included `defaultCommission` into the top-level result object.
    // Do NOT overwrite UserCommission fields if a name collision occurs.
    const flattened = records.map((row) => {
      const { defaultCommission, ...base } = row;
      if (!defaultCommission) return base;

      // merge fields from defaultCommission but prefer `base` values on collision
      const merged = { ...base };
      Object.entries(defaultCommission).forEach(([k, v]) => {
        if (k === 'id') return; // skip nested model id (we already have commission_default_id)
        // prefer explicit user-specified values (non-null); if user value is missing/null, fallback to default
        if (merged[k] === undefined || merged[k] === null) merged[k] = v;
      });
      return merged;
    });

    return res.status(200).json(flattened);
  } catch (err) {
    console.error('getUserCommissions error:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
});

// Get effective commission for given criteria — checks user-specific (linked defaults) first then global defaults
const getCommission = asyncHandler(async (req, res) => {
  const { paymentCardBrand, paymentCardType, paymentMode } = req.body;
  const targetUserId = req.body.user_id || req.user.id || null; // if null, skip user-specific
  const search = { paymentCardBrand, paymentCardType, paymentMode };

  // 1) user-specific: fetch linked CommissionDefault records for the user
  if (targetUserId) {
    const userLinks = await UserCommission.findAll({
      where: { user_id: targetUserId, is_active: true },
      include: [{ model: CommissionDefault, as: 'defaultCommission' }]
    });

    // merge user-specific overrides (flat_fee/percent_fee) into the defaultCommission object
    const userDefaults = userLinks.map(l => {
      const dd = l.defaultCommission;
      if (!dd) return null;
      const base = dd.get ? dd.get({ plain: true }) : (typeof dd === 'object' ? { ...dd } : dd);
      if (l.flat_fee !== undefined && l.flat_fee !== null) base.flat_fee = l.flat_fee;
      if (l.percent_fee !== undefined && l.percent_fee !== null) base.percent_fee = l.percent_fee;
      return base;
    }).filter(Boolean);

    const bestUser = pickMostSpecific(userDefaults, search, req.body.amount);
    if (bestUser && bestUser.is_active) {
      const amount = req.body.amount;
      const feeInfo = amount ? computeFee(bestUser, amount) : null;
      return res.status(200).json({ source: 'user', commission: bestUser, fee: feeInfo });
    }
  }

  // 2) global defaults
  const buildWhere = () => ({
    [Op.and]: [
      { [Op.or]: [{ payment_card_brand: paymentCardBrand || null }, { payment_card_brand: null }] },
      { [Op.or]: [{ payment_card_type: paymentCardType || null }, { payment_card_type: null }] },
      { [Op.or]: [{ payment_mode: paymentMode || null }, { payment_mode: null }] }
    ]
  });

  const defaultRecords = await CommissionDefault.findAll({ where: buildWhere() });
  const bestDefault = pickMostSpecific(defaultRecords, search, req.body.amount);
  if (bestDefault && bestDefault.is_active) {
    const amount = req.body.amount;
    const feeInfo = amount ? computeFee(bestDefault, amount) : null;
    return res.status(200).json({ source: 'default', commission: bestDefault, fee: feeInfo });
  }

  res.status(404).json({ message: 'No commission configuration found for given criteria' });
});

// Update default commission (admin)
const updateDefaultCommission = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }
  const { id } = req.params;
  const rec = await CommissionDefault.findByPk(id);
  if (!rec) {
    res.status(404);
    throw new Error('Default commission not found');
  }

  // Determine new values (respect existing values if not provided)
  const updates = req.body || {};
  const brand = updates.payment_card_brand !== undefined ? updates.payment_card_brand : (updates.paymentCardBrand !== undefined ? updates.paymentCardBrand : rec.payment_card_brand);
  const type = updates.payment_card_type !== undefined ? updates.payment_card_type : (updates.paymentCardType !== undefined ? updates.paymentCardType : rec.payment_card_type);
  const mode = updates.payment_mode !== undefined ? updates.payment_mode : (updates.paymentMode !== undefined ? updates.paymentMode : rec.payment_mode);

  const newMin = updates.min_amount !== undefined ? (updates.min_amount !== null ? parseFloat(updates.min_amount) : null) : (rec.min_amount !== null && rec.min_amount !== undefined ? parseFloat(rec.min_amount) : null);
  const newMax = updates.max_amount !== undefined ? (updates.max_amount !== null ? parseFloat(updates.max_amount) : null) : (rec.max_amount !== null && rec.max_amount !== undefined ? parseFloat(rec.max_amount) : null);

  if (newMin !== null && newMax !== null && newMin > newMax) {
    res.status(400);
    throw new Error('min_amount cannot be greater than max_amount');
  }

  // Check overlapping with other slabs for same brand/type/mode
  const existingSlabs = await CommissionDefault.findAll({
    where: {
      payment_card_brand: brand || null,
      payment_card_type: type || null,
      payment_mode: mode || null
    }
  });

  const minVal = newMin !== null && newMin !== undefined ? newMin : 0;
  const maxVal = newMax !== null && newMax !== undefined ? newMax : Infinity;

  const isOverlapping = existingSlabs.some((slab) => {
    if (slab.id === rec.id) return false; // ignore self
    const slabMin = slab.min_amount !== null && slab.min_amount !== undefined ? parseFloat(slab.min_amount) : 0;
    const slabMax = slab.max_amount !== null && slab.max_amount !== undefined ? parseFloat(slab.max_amount) : Infinity;
    return (minVal <= slabMax && maxVal >= slabMin);
  });

  if (isOverlapping) {
    res.status(400);
    throw new Error('Updated slab would overlap an existing commission slab');
  }

  // Enforce business rule on update: not both flat and percent non-zero
  const finalFlat = updates.flat_fee !== undefined ? (updates.flat_fee ? parseFloat(updates.flat_fee) : 0) : (rec.flat_fee ? parseFloat(rec.flat_fee) : 0);
  const finalPercent = updates.percent_fee !== undefined ? (updates.percent_fee ? parseFloat(updates.percent_fee) : 0) : (rec.percent_fee ? parseFloat(rec.percent_fee) : 0);
  if (finalFlat > 0 && finalPercent > 0) {
    res.status(400);
    throw new Error('Only one of flat_fee or percent_fee can be non-zero for a commission slab');
  }

  await rec.update(updates);
  res.status(200).json({ message: 'Updated', record: rec });
});

// Update user commission link (admin only) — change the linked default or toggle active
const updateUserCommission = asyncHandler(async (req, res) => {
  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }
  const { id } = req.params;
  const rec = await UserCommission.findByPk(id);
  if (!rec) {
    res.status(404);
    throw new Error('User commission not found');
  }

  if (req.body.commission_default_id) {
    const dd = await CommissionDefault.findByPk(req.body.commission_default_id);
    if (!dd) {
      res.status(404);
      throw new Error('commission_default_id not found');
    }
    rec.commission_default_id = dd.id;
  }

  if (typeof req.body.is_active === 'boolean') {
    rec.is_active = req.body.is_active;
  }

  // handle optional user-specific override updates
  if (req.body.flat_fee !== undefined || req.body.percent_fee !== undefined) {
    const newFlat = req.body.flat_fee !== undefined ? (req.body.flat_fee !== null ? parseFloat(req.body.flat_fee) : null) : (rec.flat_fee !== null && rec.flat_fee !== undefined ? parseFloat(rec.flat_fee) : null);
    const newPercent = req.body.percent_fee !== undefined ? (req.body.percent_fee !== null ? parseFloat(req.body.percent_fee) : null) : (rec.percent_fee !== null && rec.percent_fee !== undefined ? parseFloat(rec.percent_fee) : null);
    if (newFlat > 0 && newPercent > 0) {
      res.status(400);
      throw new Error('Only one of flat_fee or percent_fee can be non-zero for a user commission');
    }
    if (req.body.flat_fee !== undefined) rec.flat_fee = req.body.flat_fee;
    if (req.body.percent_fee !== undefined) rec.percent_fee = req.body.percent_fee;
  }

  rec.company_id = companyId;
  await rec.save();
  const updated = await UserCommission.findByPk(rec.id, { include: [{ model: CommissionDefault, as: 'defaultCommission' }] });
  res.status(200).json({ message: 'Updated', record: updated });
});

const deleteDefaultCommission = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }
  const { id } = req.params;
  const rec = await CommissionDefault.findByPk(id);
  if (!rec) {
    res.status(404);
    throw new Error('Default commission not found');
  }
  await rec.destroy();
  res.status(200).json({ message: 'Deleted' });
});

const deleteUserCommission = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }
  const { id } = req.params;
  const rec = await UserCommission.findByPk(id);
  if (!rec) {
    res.status(404);
    throw new Error('User commission not found');
  }
  await rec.destroy();
  res.status(200).json({ message: 'Deleted' });
});

module.exports = {
  createDefaultCommission,
  getDefaultCommissions,
  createUserCommission,
  getUserCommissions,
  getCommission,
  updateDefaultCommission,
  updateUserCommission,
  deleteDefaultCommission,
  deleteUserCommission,

  // exported for unit tests
  computeFee,
  pickMostSpecific
};

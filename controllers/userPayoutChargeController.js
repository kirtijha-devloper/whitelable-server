const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const UserPayoutCharge = require('../models/UserPayoutCharge');
const User = require('../models/User');

// ── Helper: check for overlapping slab range for a user ──────────────────────
async function checkSlabOverlap(userId, fromAmount, toAmount, excludeId = null) {
  const where = {
    user_id: userId,
    from_amount: { [Op.lte]: toAmount },
    to_amount: { [Op.gte]: fromAmount },
  };
  if (excludeId) {
    where.id = { [Op.ne]: excludeId };
  }
  return UserPayoutCharge.findOne({ where });
}

// ── Create a new user payout charge rule ─────────────────────────────────────
const createUserPayoutCharge = asyncHandler(async (req, res) => {
  const { user_id, from_amount, to_amount, rate, rate_type, is_active, description } = req.body;

  if (!user_id || from_amount === undefined || to_amount === undefined || rate === undefined || !rate_type) {
    return res.status(400).json({ success: false, message: 'user_id, from_amount, to_amount, rate, and rate_type are required' });
  }

  const user = await User.findByPk(user_id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (!['percentage', 'flat'].includes(rate_type)) {
    return res.status(400).json({ success: false, message: 'rate_type must be "percentage" or "flat"' });
  }

  const numFrom = parseFloat(from_amount);
  const numTo = parseFloat(to_amount);
  const numRate = parseFloat(rate);

  if (isNaN(numFrom) || isNaN(numTo) || numFrom >= numTo) {
    return res.status(400).json({ success: false, message: 'from_amount must be strictly less than to_amount' });
  }
  if (isNaN(numRate) || numRate < 0) {
    return res.status(400).json({ success: false, message: 'rate must be >= 0' });
  }

  const overlap = await checkSlabOverlap(user_id, numFrom, numTo);
  if (overlap) {
    return res.status(400).json({
      success: false,
      message: `Range (${numFrom}–${numTo}) overlaps with existing slab ID ${overlap.id} (${overlap.from_amount}–${overlap.to_amount}) for this user`,
    });
  }

  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  const rule = await UserPayoutCharge.create({
    user_id,
    from_amount: numFrom,
    to_amount: numTo,
    rate: numRate,
    rate_type,
    is_active: is_active !== undefined ? is_active : true,
    description: description || null,
    company_id : companyId,
  });

  return res.status(201).json({ success: true, data: rule });
});

// ── List all rules (optionally filtered by user_id / is_active) ──────────────
const listAllUserPayoutCharges = asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.user_id) where.user_id = req.query.user_id;
  if (req.query.is_active !== undefined) where.is_active = req.query.is_active === 'true';

  const rules = await UserPayoutCharge.findAll({
    where,
    order: [['user_id', 'ASC'], ['from_amount', 'ASC']],
  });

  return res.status(200).json({ success: true, data: rules });
});

// ── Get all rules for a specific user ────────────────────────────────────────
const getUserPayoutChargesByUser = asyncHandler(async (req, res) => {
  const rules = await UserPayoutCharge.findAll({
    where: { user_id: req.params.userId },
    order: [['from_amount', 'ASC']],
  });
  return res.status(200).json({ success: true, data: rules });
});

// ── Get single rule by ID ─────────────────────────────────────────────────────
const getUserPayoutChargeById = asyncHandler(async (req, res) => {
  const rule = await UserPayoutCharge.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'User payout charge rule not found' });
  }
  return res.status(200).json({ success: true, data: rule });
});

// ── Update a rule ─────────────────────────────────────────────────────────────
const updateUserPayoutCharge = asyncHandler(async (req, res) => {
  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  const rule = await UserPayoutCharge.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'User payout charge rule not found' });
  }

  const { from_amount, to_amount, rate, rate_type, is_active, description } = req.body;

  if (rate_type !== undefined && !['percentage', 'flat'].includes(rate_type)) {
    return res.status(400).json({ success: false, message: 'rate_type must be "percentage" or "flat"' });
  }

  const newFrom = from_amount !== undefined ? parseFloat(from_amount) : parseFloat(rule.from_amount);
  const newTo = to_amount !== undefined ? parseFloat(to_amount) : parseFloat(rule.to_amount);

  if (newFrom >= newTo) {
    return res.status(400).json({ success: false, message: 'from_amount must be strictly less than to_amount' });
  }

  const overlap = await checkSlabOverlap(rule.user_id, newFrom, newTo, rule.id);
  if (overlap) {
    return res.status(400).json({
      success: false,
      message: `Range (${newFrom}–${newTo}) overlaps with existing slab ID ${overlap.id} (${overlap.from_amount}–${overlap.to_amount}) for this user`,
    });
  }

  if (from_amount !== undefined) rule.from_amount = newFrom;
  if (to_amount !== undefined) rule.to_amount = newTo;
  if (rate !== undefined) rule.rate = parseFloat(rate);
  if (rate_type !== undefined) rule.rate_type = rate_type;
  if (is_active !== undefined) rule.is_active = is_active;
  if (description !== undefined) rule.description = description;

  rule.company_id = companyId;
  await rule.save();
  return res.status(200).json({ success: true, data: rule });
});

// ── Delete a rule ─────────────────────────────────────────────────────────────
const deleteUserPayoutCharge = asyncHandler(async (req, res) => {
  const rule = await UserPayoutCharge.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'User payout charge rule not found' });
  }
  await rule.destroy();
  return res.status(200).json({ success: true, message: 'User payout charge rule deleted' });
});

module.exports = {
  createUserPayoutCharge,
  listAllUserPayoutCharges,
  getUserPayoutChargesByUser,
  getUserPayoutChargeById,
  updateUserPayoutCharge,
  deleteUserPayoutCharge,
};

const asyncHandler = require("express-async-handler");
const PayoutCharge = require('../models/PayoutCharge');

// ── List all payout charge rules (admin only) ────────────────────────────────
const listPayoutCharges = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  const rules = await PayoutCharge.findAll({ order: [['from_amount', 'ASC']] });
  return res.status(200).json({ success: true, data: rules });
});

// ── Get a single payout charge rule by id (admin only) ───────────────────────
const getPayoutCharge = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  const rule = await PayoutCharge.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'Payout charge rule not found' });
  }
  return res.status(200).json({ success: true, data: rule });
});

// ── Create a new payout charge rule (admin only) ─────────────────────────────
const createPayoutCharge = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const { from_amount, to_amount, rate, rate_type, is_active, description } = req.body;

  if (from_amount === undefined || to_amount === undefined || rate === undefined || !rate_type) {
    return res.status(400).json({ success: false, message: 'from_amount, to_amount, rate, and rate_type are required' });
  }
  if (!['percentage', 'flat'].includes(rate_type)) {
    return res.status(400).json({ success: false, message: 'rate_type must be "percentage" or "flat"' });
  }
  if (parseFloat(from_amount) >= parseFloat(to_amount)) {
    return res.status(400).json({ success: false, message: 'from_amount must be less than to_amount' });
  }
  if (parseFloat(rate) < 0) {
    return res.status(400).json({ success: false, message: 'rate must be >= 0' });
  }

  const rule = await PayoutCharge.create({
    from_amount,
    to_amount,
    rate,
    rate_type,
    is_active: is_active !== undefined ? is_active : true,
    description: description || null,
  });

  return res.status(201).json({ success: true, data: rule });
});

// ── Update a payout charge rule (admin only) ─────────────────────────────────
const updatePayoutCharge = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const rule = await PayoutCharge.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'Payout charge rule not found' });
  }

  const { from_amount, to_amount, rate, rate_type, is_active, description } = req.body;

  if (rate_type !== undefined && !['percentage', 'flat'].includes(rate_type)) {
    return res.status(400).json({ success: false, message: 'rate_type must be "percentage" or "flat"' });
  }

  const newFrom  = from_amount !== undefined ? parseFloat(from_amount) : parseFloat(rule.from_amount);
  const newTo    = to_amount   !== undefined ? parseFloat(to_amount)   : parseFloat(rule.to_amount);
  if (newFrom >= newTo) {
    return res.status(400).json({ success: false, message: 'from_amount must be less than to_amount' });
  }

  if (from_amount  !== undefined) rule.from_amount  = from_amount;
  if (to_amount    !== undefined) rule.to_amount    = to_amount;
  if (rate         !== undefined) rule.rate         = rate;
  if (rate_type    !== undefined) rule.rate_type    = rate_type;
  if (is_active    !== undefined) rule.is_active    = is_active;
  if (description  !== undefined) rule.description  = description;

  await rule.save();
  return res.status(200).json({ success: true, data: rule });
});

// ── Delete a payout charge rule (admin only) ─────────────────────────────────
const deletePayoutCharge = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const rule = await PayoutCharge.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'Payout charge rule not found' });
  }

  await rule.destroy();
  return res.status(200).json({ success: true, message: 'Payout charge rule deleted' });
});

module.exports = {
  createPayoutCharge,
  getPayoutCharge,
  listPayoutCharges,
  updatePayoutCharge,
  deletePayoutCharge,
};


const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const PosChargeRule = require('../models/PosChargeRule');
const ChargeService = require('../services/chargeService');

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
    is_active
  } = req.body;

  // basic validation
  const errs = validateRuleInput(req.body);
  if (errs.length) {
    return res.status(400).json({ success: false, errors: errs });
  }

  // duplicate check: exact same combination
  const duplicate = await PosChargeRule.findOne({
    where: {
      user_id: user_id || null,
      payment_mode: payment_mode || null,
      card_type: card_type || null,
      card_brand: card_brand || null,
      card_classification: card_classification || null,
      settlement_type: settlement_type || null,
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
    payment_mode: payment_mode || null,
    card_type: card_type || null,
    card_brand: card_brand || null,
    card_classification: card_classification || null,
    settlement_type: settlement_type || null
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
      payment_mode: payment_mode || null,
      card_type: card_type || null,
      card_brand: card_brand || null,
      card_classification: card_classification || null,
      settlement_type: settlement_type || null,
      min_amount: min_amount !== undefined ? min_amount : 0,
      max_amount: max_amount || null,
      charge_percent,
      charge_flat: charge_flat || 0,
      gst_required: Boolean(gst_required),
      gst_percent: gst_percent !== undefined && gst_percent !== null ? gst_percent : 0,
      is_active: typeof is_active === 'boolean' ? is_active : true
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

// list rules with filters & pagination
const listPosChargeRules = asyncHandler(async (req, res) => {
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
  const where = {};
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

// update rule
const updatePosChargeRule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: 'id required' });

  const rec = await PosChargeRule.findByPk(id);
  if (!rec) return res.status(404).json({ success: false, message: 'Rule not found' });

  const errs = validateRuleInput(req.body);
  if (errs.length) {
    return res.status(400).json({ success: false, errors: errs });
  }

  // if slab or identifiers changed, ensure not creating duplicate
  const {
    user_id,
    payment_mode,
    card_type,
    card_brand,
    card_classification,
    settlement_type,
    min_amount,
    max_amount
  } = req.body;

  if (
    user_id !== undefined ||
    payment_mode !== undefined ||
    card_type !== undefined ||
    card_brand !== undefined ||
    card_classification !== undefined ||
    settlement_type !== undefined ||
    min_amount !== undefined ||
    max_amount !== undefined ||
    gst_required !== undefined ||
    gst_percent !== undefined
  ) {
    const dup = await PosChargeRule.findOne({
      where: {
        id: { [Op.ne]: id },
        user_id: user_id !== undefined ? user_id || null : rec.user_id,
        payment_mode: payment_mode !== undefined ? payment_mode || null : rec.payment_mode,
        card_type: card_type !== undefined ? card_type || null : rec.card_type,
        card_brand: card_brand !== undefined ? card_brand || null : rec.card_brand,
        card_classification: card_classification !== undefined ? card_classification || null : rec.card_classification,
        settlement_type: settlement_type !== undefined ? settlement_type || null : rec.settlement_type,
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
      payment_mode: payment_mode !== undefined ? payment_mode || null : rec.payment_mode,
      card_type: card_type !== undefined ? card_type || null : rec.card_type,
      card_brand: card_brand !== undefined ? card_brand || null : rec.card_brand,
      card_classification: card_classification !== undefined ? card_classification || null : rec.card_classification,
      settlement_type: settlement_type !== undefined ? settlement_type || null : rec.settlement_type
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
  if (req.body.gst_required !== undefined) updateData.gst_required = Boolean(req.body.gst_required);
  if (req.body.gst_percent !== undefined) updateData.gst_percent = req.body.gst_percent;
  await rec.update(updateData);
  res.status(200).json({ success: true, message: 'Rule updated', record: rec });
});

// delete rule
const deletePosChargeRule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: 'id required' });

  const rec = await PosChargeRule.findByPk(id);
  if (!rec) return res.status(404).json({ success: false, message: 'Rule not found' });

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

  let rule = await ChargeService.getTransactionChargeRule({
    userId: user_id,
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
  updatePosChargeRule,
  deletePosChargeRule,
  calculateCharge
};

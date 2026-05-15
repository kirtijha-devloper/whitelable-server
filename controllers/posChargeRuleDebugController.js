const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const PosChargeRule = require('../models/PosChargeRule');
const User = require('../models/User');
const ChargeService = require('../services/chargeService');

const {
  normalizeCardBrand,
  normalizeLookupValue,
  getCardBrandCandidates,
} = ChargeService;

function toPlainRule(rule) {
  if (!rule) return null;
  return rule.toJSON ? rule.toJSON() : { ...rule };
}

function buildNullableMatch(column, value) {
  return {
    [Op.or]: [
      { [column]: value },
      { [column]: null }
    ]
  };
}

function getRuleSpecificityScore(rule) {
  let score = 0;

  switch (rule.scope) {
    case 'franchise_merchant':
      score += 64;
      break;
    case 'admin_merchant':
      score += 48;
      break;
    case 'franchise_default':
      score += 32;
      break;
    case 'admin_franchise':
      score += 16;
      break;
    default:
      score += 0;
      break;
  }

  if (rule.settlement_type != null) score += 8;
  if (rule.card_classification != null) score += 4;
  if (rule.card_brand != null) score += 2;
  if (rule.card_type != null) score += 1;

  if (rule.min_amount != null && rule.max_amount != null) {
    const min = parseFloat(rule.min_amount);
    const max = parseFloat(rule.max_amount);
    if (!Number.isNaN(min) && !Number.isNaN(max)) {
      const range = Math.max(0, max - min);
      score += Math.max(0, Math.floor(1000 / (range + 1)));
    }
  }

  return score;
}

function summarizeChargeRule(rule) {
  if (!rule) return null;

  return {
    id: rule.id,
    scope: rule.scope,
    user_id: rule.user_id,
    franchaise_id: rule.franchaise_id,
    payment_mode: rule.payment_mode,
    card_type: rule.card_type,
    card_brand: rule.card_brand,
    card_classification: rule.card_classification,
    settlement_type: rule.settlement_type,
    min_amount: rule.min_amount !== undefined && rule.min_amount !== null ? parseFloat(rule.min_amount) : null,
    max_amount: rule.max_amount !== undefined && rule.max_amount !== null ? parseFloat(rule.max_amount) : null,
    charge_percent: rule.charge_percent !== undefined && rule.charge_percent !== null ? parseFloat(rule.charge_percent) : null,
    charge_flat: rule.charge_flat !== undefined && rule.charge_flat !== null ? parseFloat(rule.charge_flat) : 0,
    gst_required: Boolean(rule.gst_required),
    gst_percent: rule.gst_percent !== undefined && rule.gst_percent !== null ? parseFloat(rule.gst_percent) : 0,
    is_active: Boolean(rule.is_active)
  };
}

function buildChargePreview(rule, amount) {
  if (!rule || amount === undefined || amount === null) {
    return null;
  }

  const numericAmount = parseFloat(amount);
  if (Number.isNaN(numericAmount) || numericAmount <= 0) {
    return null;
  }

  const chargeResult = ChargeService.calculateCharge(numericAmount, rule);
  const chargeAmount = parseFloat(chargeResult.charge || 0);
  const gstAmount = parseFloat(chargeResult.gstAmount || 0);
  const totalDeducted = parseFloat((chargeAmount + gstAmount).toFixed(2));
  const merchantSettlement = parseFloat((numericAmount - totalDeducted).toFixed(2));

  return {
    amount: numericAmount,
    charge_amount: chargeAmount,
    gst_amount: gstAmount,
    total_deducted: totalDeducted,
    merchant_settlement: merchantSettlement
  };
}

async function resolveBestChargeRuleWithoutAmount({
  userId,
  franchiseId,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
}) {
  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const normalizedSettlement = normalizeLookupValue(settlement);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);
  const candidateBrands = cardBrandCandidates.length ? cardBrandCandidates : [null];

  for (const brandCandidate of candidateBrands) {
    const where = {
      is_active: true,
      [Op.or]: [
        { user_id: userId },
        {
          user_id: null,
          [Op.or]: [
            { franchaise_id: franchiseId },
            { franchaise_id: null }
          ]
        }
      ],
      [Op.and]: [
        buildNullableMatch('payment_mode', normalizedPaymentMode),
        buildNullableMatch('card_type', normalizedCardType),
        buildNullableMatch('card_brand', brandCandidate),
        buildNullableMatch('card_classification', normalizedClassification),
        buildNullableMatch('settlement_type', normalizedSettlement)
      ]
    };

    const rows = await PosChargeRule.findAll({
      where,
      order: [['createdAt', 'DESC']]
    });

    if (!rows.length) {
      continue;
    }

    let best = null;
    let bestScore = -Infinity;

    for (const row of rows) {
      const plain = toPlainRule(row);
      const score = getRuleSpecificityScore(plain);
      if (score > bestScore) {
        bestScore = score;
        best = plain;
      }
    }

    if (best) {
      return best;
    }
  }

  return null;
}

async function resolveChargeDebugSnapshot({
  user,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount,
}) {
  const amountProvided = amount !== undefined && amount !== null && String(amount).trim() !== '';
  const numericAmount = amountProvided ? parseFloat(amount) : null;
  const exactRule = amountProvided && !Number.isNaN(numericAmount) && numericAmount > 0
    ? await ChargeService.getTransactionChargeRule({
        userId: user.id,
        franchiseId: user.franchaise_id || (user.role === 'franchaise' ? user.id : null),
        paymentMode,
        cardType,
        cardBrand,
        classification,
        settlement,
        amount: numericAmount
      })
    : null;

  const candidateRule = await resolveBestChargeRuleWithoutAmount({
    userId: user.id,
    franchiseId: user.franchaise_id || (user.role === 'franchaise' ? user.id : null),
    paymentMode,
    cardType,
    cardBrand,
    classification,
    settlement
  });

  const selectedRule = exactRule || candidateRule;
  const matchMode = exactRule ? 'exact' : (amountProvided ? 'best_effort' : 'rate_only');
  const preview = amountProvided
    ? buildChargePreview(selectedRule, numericAmount)
    : null;

  return {
    match_mode: matchMode,
    result_source: exactRule ? 'exact_rule_engine' : (amountProvided ? 'best_effort_candidate' : 'rate_only'),
    warning: amountProvided && !exactRule ? 'No exact amount-based rule matched; preview uses the best matching rule by settlement and card filters.' : null,
    exact_rule: summarizeChargeRule(exactRule),
    candidate_rule: summarizeChargeRule(candidateRule),
    rule: summarizeChargeRule(selectedRule),
    preview
  };
}

const myChargesDebug = asyncHandler(async (req, res) => {
  try {
    const {
      user_id,
      mobile_number,
      phone_number,
      mobile,
      payment_mode,
      card_type,
      card_brand,
      network,
      card_classification,
      amount,
    } = req.body;

    const lookupMobile = mobile_number || phone_number || mobile || null;
    const amountProvided = amount !== undefined && amount !== null && String(amount).trim() !== '';
    const parsedAmount = amountProvided ? parseFloat(amount) : null;

    if (amountProvided && (Number.isNaN(parsedAmount) || parsedAmount <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'amount must be a positive number when provided'
      });
    }

    let user = null;

    if (user_id !== undefined && user_id !== null && String(user_id).trim() !== '') {
      const parsedUserId = parseInt(user_id, 10);
      if (!Number.isNaN(parsedUserId)) {
        user = await User.findByPk(parsedUserId);
      }
    }

    if (!user && lookupMobile) {
      user = await User.findOne({
        where: { mobile_number: String(lookupMobile).trim() }
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found for the provided user_id or mobile number'
      });
    }

    const normalizedPaymentMode = normalizeLookupValue(payment_mode);
    const normalizedCardType = normalizeLookupValue(card_type);
    const normalizedCardBrand = normalizeCardBrand(card_brand || network);
    const normalizedClassification = normalizeLookupValue(card_classification);

    const todaySnapshot = await resolveChargeDebugSnapshot({
      user,
      paymentMode: normalizedPaymentMode,
      cardType: normalizedCardType,
      cardBrand: normalizedCardBrand,
      classification: normalizedClassification,
      settlement: 'today_settlement',
      amount
    });

    const nextDaySnapshot = await resolveChargeDebugSnapshot({
      user,
      paymentMode: normalizedPaymentMode,
      cardType: normalizedCardType,
      cardBrand: normalizedCardBrand,
      classification: normalizedClassification,
      settlement: 'next_day_settlement',
      amount
    });

    const liveSettlementType = user.settlement_type || null;
    const liveSnapshot = liveSettlementType === 'today_settlement'
      ? todaySnapshot
      : liveSettlementType === 'next_day_settlement'
        ? nextDaySnapshot
        : null;

    return res.status(200).json({
      success: true,
      message: 'Charge debug snapshot generated successfully',
      input: {
        user_id: user.id,
        mobile_number: user.mobile_number || null,
        payment_mode: normalizedPaymentMode,
        card_type: normalizedCardType,
        card_brand: normalizedCardBrand,
        card_classification: normalizedClassification,
        amount: amountProvided ? parsedAmount : null
      },
      user: {
        id: user.id,
        name: user.name || null,
        email: user.email || null,
        mobile_number: user.mobile_number || null,
        role: user.role || null,
        settlement_type: user.settlement_type || null,
        franchaise_id: user.franchaise_id || null,
        abheepay_id: user.abheepay_id || null,
        status: user.status || null
      },
      live_settlement_type: liveSettlementType,
      live: liveSnapshot,
      t0: todaySnapshot,
      tplus1: nextDaySnapshot
    });
  } catch (error) {
    console.error('myChargesDebug error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

module.exports = { myChargesDebug };

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
      { [column]: null },
      { [column]: 'ANY' },
      { [column]: 'any' }
    ]
  };
}

function normalizeSettlementValue(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function getScopeWeight(scope) {
  switch (scope) {
    case 'franchise_merchant':
      return 64;
    case 'admin_merchant':
      return 48;
    case 'franchise_default':
      return 32;
    case 'admin_franchise':
      return 16;
    default:
      return 0;
  }
}

function getSpecificityBreakdown(rule, search = {}) {
  const scopeWeight = getScopeWeight(rule.scope);
  const normalizedSearchPaymentMode = normalizeLookupValue(search.paymentMode);
  const normalizedSearchCardType = normalizeLookupValue(search.cardType);
  const normalizedSearchBrand = search.cardBrand ? normalizeCardBrand(search.cardBrand) : null;
  const normalizedSearchClassification = normalizeLookupValue(search.classification);
  const normalizedSearchSettlement = normalizeLookupValue(search.settlement);
  const normalizedSearchCompanyName = normalizeLookupValue(search.companyName);
  const normalizedRulePaymentMode = normalizeLookupValue(rule.payment_mode);
  const normalizedRuleCardType = normalizeLookupValue(rule.card_type);
  const normalizedRuleBrand = normalizeCardBrand(rule.card_brand);
  const normalizedRuleClassification = normalizeLookupValue(rule.card_classification);
  const normalizedRuleSettlement = normalizeLookupValue(rule.settlement_type);
  const normalizedRuleCompanyName = normalizeLookupValue(rule.company_name);
  const companyNameWeight = normalizedSearchCompanyName && normalizedRuleCompanyName === normalizedSearchCompanyName && normalizedRuleCompanyName !== 'ANY' ? 32000 : 0;
  const paymentModeWeight = normalizedSearchPaymentMode && normalizedRulePaymentMode === normalizedSearchPaymentMode && normalizedRulePaymentMode !== 'ANY' ? 16000 : 0;
  const settlementWeight = normalizedSearchSettlement && normalizedRuleSettlement === normalizedSearchSettlement && normalizedRuleSettlement !== 'ANY' ? 8000 : 0;
  const classificationWeight = normalizedSearchClassification && normalizedRuleClassification === normalizedSearchClassification && normalizedRuleClassification !== 'ANY' ? 4000 : 0;
  const brandWeight = normalizedSearchBrand && normalizedRuleBrand === normalizedSearchBrand && normalizedRuleBrand !== 'ANY' ? 2000 : 0;
  const cardTypeWeight = normalizedSearchCardType && normalizedRuleCardType === normalizedSearchCardType && normalizedRuleCardType !== 'ANY' ? 1000 : 0;
  let amountWeight = 0;

  if (rule.min_amount != null && rule.max_amount != null) {
    const min = parseFloat(rule.min_amount);
    const max = parseFloat(rule.max_amount);
    if (!Number.isNaN(min) && !Number.isNaN(max)) {
      const range = Math.max(0, max - min);
      amountWeight = Math.max(0, Math.floor(1000 / (range + 1)));
    }
  }

  return {
    scope_weight: scopeWeight,
    company_name_weight: companyNameWeight,
    payment_mode_weight: paymentModeWeight,
    card_type_weight: cardTypeWeight,
    card_brand_weight: brandWeight,
    card_classification_weight: classificationWeight,
    settlement_weight: settlementWeight,
    amount_range_weight: amountWeight
  };
}

function getRuleSpecificityScore(rule, search = {}) {
  const breakdown = getSpecificityBreakdown(rule, search);
  return Object.values(breakdown).reduce((sum, value) => sum + value, 0);
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
    company_name: rule.company_name,
    min_amount: rule.min_amount !== undefined && rule.min_amount !== null ? parseFloat(rule.min_amount) : null,
    max_amount: rule.max_amount !== undefined && rule.max_amount !== null ? parseFloat(rule.max_amount) : null,
    charge_percent: rule.charge_percent !== undefined && rule.charge_percent !== null ? parseFloat(rule.charge_percent) : null,
    charge_flat: rule.charge_flat !== undefined && rule.charge_flat !== null ? parseFloat(rule.charge_flat) : 0,
    gst_required: Boolean(rule.gst_required),
    gst_percent: rule.gst_percent !== undefined && rule.gst_percent !== null ? parseFloat(rule.gst_percent) : 0,
    is_active: Boolean(rule.is_active)
  };
}

function summarizeRankedRuleCandidate(candidate, index) {
  return {
    rank: index + 1,
    specificity_score: candidate.specificity_score,
    specificity_breakdown: candidate.specificity_breakdown,
    brand_candidate: candidate.brand_candidate,
    rule: summarizeChargeRule(candidate.rule)
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

function buildExactMatchWhere({
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  companyName,
  amount,
}) {
  const where = {
    is_active: true
  };

  if (paymentMode) where.payment_mode = paymentMode;
  if (cardType) where.card_type = cardType;
  if (cardBrand) where.card_brand = cardBrand;
  if (classification) where.card_classification = classification;
  if (settlement) where.settlement_type = settlement;
  if (companyName) where.company_name = companyName;

  const amountProvided = amount !== undefined && amount !== null && String(amount).trim() !== '';
  const numericAmount = amountProvided ? parseFloat(amount) : null;
  if (amountProvided && !Number.isNaN(numericAmount) && numericAmount > 0) {
    where.min_amount = { [Op.lte]: numericAmount };
    where[Op.or] = [
      { max_amount: { [Op.gte]: numericAmount } },
      { max_amount: null }
    ];
  }

  return { where, amountProvided, numericAmount };
}

function getUiScopeOrder(userRole) {
  return ['admin_default'];
}

function buildUiScopeWhere(scope, user) {
  switch (scope) {
    case 'admin_default':
      return { scope: 'admin_default' };
    default:
      return null;
  }
}

async function resolveUiChargeSnapshot({
  user,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  companyName,
  amount,
}) {
  const exactSettlement = normalizeSettlementValue(settlement);
  const exactCardBrand = cardBrand ? normalizeCardBrand(cardBrand) : null;
  const exactPaymentMode = normalizeLookupValue(paymentMode);
  const exactCardType = normalizeLookupValue(cardType);
  const exactClassification = normalizeLookupValue(classification);
  const exactCompanyName = normalizeLookupValue(companyName);
  const { where: exactWhere, amountProvided, numericAmount } = buildExactMatchWhere({
    paymentMode: exactPaymentMode,
    cardType: exactCardType,
    cardBrand: exactCardBrand,
    classification: exactClassification,
    settlement: exactSettlement,
    companyName: exactCompanyName,
    amount
  });

  const scopeOrder = getUiScopeOrder(user.role);
  const groupResults = {};
  let selectedRule = null;
  let selectedGroup = null;

  for (const scope of scopeOrder) {
    const scopeWhere = buildUiScopeWhere(scope, user);
    if (!scopeWhere) {
      groupResults[scope] = [];
      continue;
    }

    const rows = await PosChargeRule.findAll({
      where: {
        ...exactWhere,
        ...scopeWhere
      },
      order: [['createdAt', 'DESC']]
    });

    const summarizedRows = rows.map(toPlainRule);
    groupResults[scope] = summarizedRows.map(summarizeChargeRule);

    if (!selectedRule && summarizedRows.length > 0) {
      selectedRule = summarizedRows[0];
      selectedGroup = scope;
    }
  }

  return {
    mode: 'ui_display',
    scope_order: scopeOrder,
    selected_group: selectedGroup,
    rule: summarizeChargeRule(selectedRule),
    preview: amountProvided ? buildChargePreview(selectedRule, numericAmount) : null,
    groups: groupResults,
    selection_explanation: selectedRule
      ? `Selected from ${selectedGroup} using exact UI list filters.`
      : 'No exact UI rule matched the provided filters.'
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
  companyName,
}) {
  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const normalizedSettlement = normalizeLookupValue(settlement);
  const normalizedCompanyName = normalizeLookupValue(companyName);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);
  const candidateBrands = cardBrandCandidates.length ? cardBrandCandidates : [null];

  for (const brandCandidate of candidateBrands) {
    const where = {
      is_active: true,
      [Op.or]: [
        { user_id: userId || null },
        {
          user_id: null,
          [Op.or]: [
            { franchaise_id: franchiseId || null },
            { franchaise_id: null }
          ]
        }
      ],
      [Op.and]: [
        buildNullableMatch('payment_mode', normalizedPaymentMode),
        buildNullableMatch('card_type', normalizedCardType),
        buildNullableMatch('card_brand', brandCandidate),
        buildNullableMatch('card_classification', normalizedClassification),
        buildNullableMatch('settlement_type', normalizedSettlement),
        buildNullableMatch('company_name', normalizedCompanyName)
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
    const scoreSearch = {
      paymentMode: normalizedPaymentMode,
      cardType: normalizedCardType,
      cardBrand: brandCandidate,
      classification: normalizedClassification,
      settlement: normalizedSettlement,
      companyName: normalizedCompanyName
    };

    for (const row of rows) {
      const plain = toPlainRule(row);
      const score = getRuleSpecificityScore(plain, scoreSearch);
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

async function findRankedChargeRuleCandidates({
  userId,
  franchiseId,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  companyName,
  amount,
}) {
  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const normalizedSettlement = normalizeLookupValue(settlement);
  const normalizedCompanyName = normalizeLookupValue(companyName);
  const amountProvided = amount !== undefined && amount !== null && String(amount).trim() !== '';
  const numericAmount = amountProvided ? parseFloat(amount) : null;
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);
  const candidateBrands = cardBrandCandidates.length ? cardBrandCandidates : [null];
  const seen = new Map();

  for (const brandCandidate of candidateBrands) {
    const where = {
      is_active: true,
      [Op.or]: [
        { user_id: userId || null },
        {
          user_id: null,
          [Op.or]: [
            { franchaise_id: franchiseId || null },
            { franchaise_id: null }
          ]
        }
      ],
      [Op.and]: [
        buildNullableMatch('payment_mode', normalizedPaymentMode),
        buildNullableMatch('card_type', normalizedCardType),
        buildNullableMatch('card_brand', brandCandidate),
        buildNullableMatch('card_classification', normalizedClassification),
        buildNullableMatch('settlement_type', normalizedSettlement),
        buildNullableMatch('company_name', normalizedCompanyName)
      ]
    };

    if (amountProvided && !Number.isNaN(numericAmount) && numericAmount > 0) {
      where[Op.and].push({
        min_amount: { [Op.lte]: numericAmount }
      });
      where[Op.and].push({
        [Op.or]: [
          { max_amount: { [Op.gte]: numericAmount } },
          { max_amount: null }
        ]
      });
    }

    const rows = await PosChargeRule.findAll({
      where,
      order: [['createdAt', 'DESC']]
    });

    const scoreSearch = {
      paymentMode: normalizedPaymentMode,
      cardType: normalizedCardType,
      cardBrand: brandCandidate,
      classification: normalizedClassification,
      settlement: normalizedSettlement,
      companyName: normalizedCompanyName
    };

    for (const row of rows) {
      const plain = toPlainRule(row);
      if (seen.has(plain.id)) {
        continue;
      }

      const specificity_breakdown = getSpecificityBreakdown(plain, scoreSearch);
      const specificity_score = Object.values(specificity_breakdown).reduce((sum, value) => sum + value, 0);
      seen.set(plain.id, {
        rule: plain,
        specificity_score,
        specificity_breakdown,
        brand_candidate: brandCandidate
      });
    }
  }

  return Array.from(seen.values()).sort((left, right) => {
    if (right.specificity_score !== left.specificity_score) {
      return right.specificity_score - left.specificity_score;
    }

    const rightCreated = right.rule.createdAt ? new Date(right.rule.createdAt).getTime() : 0;
    const leftCreated = left.rule.createdAt ? new Date(left.rule.createdAt).getTime() : 0;
    if (rightCreated !== leftCreated) {
      return rightCreated - leftCreated;
    }

    return (right.rule.id || 0) - (left.rule.id || 0);
  });
}

async function resolveTransactionChargeSnapshot({
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
        userRole: user.role,
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

  const rankedCandidates = amountProvided
    ? await findRankedChargeRuleCandidates({
        userId: user.id,
        franchiseId: user.franchaise_id || (user.role === 'franchaise' ? user.id : null),
        paymentMode,
        cardType,
        cardBrand,
        classification,
        settlement,
        amount: numericAmount
      })
    : [];

  const rankedRuleSummaries = rankedCandidates.map((candidate, index) => summarizeRankedRuleCandidate(candidate, index));
  const selectedRule = exactRule || candidateRule || (rankedCandidates[0] ? rankedCandidates[0].rule : null);
  const matchMode = exactRule ? 'exact' : (amountProvided ? 'best_effort' : 'rate_only');
  const preview = amountProvided
    ? buildChargePreview(selectedRule, numericAmount)
    : null;

  let selectionExplanation = null;
  if (rankedRuleSummaries.length >= 2) {
    const winner = rankedRuleSummaries[0];
    const runnerUp = rankedRuleSummaries[1];
    const winnerScope = winner.rule ? winner.rule.scope : null;
    const runnerScope = runnerUp.rule ? runnerUp.rule.scope : null;

    if (winnerScope && runnerScope && winnerScope !== runnerScope) {
      selectionExplanation = `Rule ${winner.rule.id} won because ${winnerScope} has a higher scope weight than ${runnerScope}.`;
    } else if (winner.specificity_score !== runnerUp.specificity_score) {
      selectionExplanation = `Rule ${winner.rule.id} won because its specificity score (${winner.specificity_score}) is higher than rule ${runnerUp.rule.id} (${runnerUp.specificity_score}).`;
    }
  }

  return {
    match_mode: matchMode,
    result_source: exactRule ? 'exact_rule_engine' : (amountProvided ? 'best_effort_candidate' : 'rate_only'),
    warning: amountProvided && !exactRule ? 'No exact amount-based rule matched; preview uses the best matching rule by settlement and card filters.' : null,
    exact_rule: summarizeChargeRule(exactRule),
    candidate_rule: summarizeChargeRule(candidateRule),
    rule: summarizeChargeRule(selectedRule),
    preview,
    ranked_rules: rankedRuleSummaries,
    selection_explanation: selectionExplanation
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
      company_name,
      companyName
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
    const normalizedCompanyName = normalizeLookupValue(company_name || companyName);

    const transactionTodaySnapshot = await resolveTransactionChargeSnapshot({
      user,
      paymentMode: normalizedPaymentMode,
      cardType: normalizedCardType,
      cardBrand: normalizedCardBrand,
      classification: normalizedClassification,
      settlement: 'today_settlement',
      amount,
      companyName: normalizedCompanyName
    });

    const transactionTplus1Snapshot = await resolveTransactionChargeSnapshot({
      user,
      paymentMode: normalizedPaymentMode,
      cardType: normalizedCardType,
      cardBrand: normalizedCardBrand,
      classification: normalizedClassification,
      settlement: 'next_day_settlement',
      amount,
      companyName: normalizedCompanyName
    });

    const liveSettlementType = user.settlement_type || null;
    const liveTransactionSnapshot = liveSettlementType === 'today_settlement'
      ? transactionTodaySnapshot
      : liveSettlementType === 'next_day_settlement'
        ? transactionTplus1Snapshot
        : transactionTodaySnapshot;

    const selectedCharge = liveTransactionSnapshot ? {
      amount: amountProvided ? parsedAmount : null,
      charge_percent: liveTransactionSnapshot.rule ? parseFloat(liveTransactionSnapshot.rule.charge_percent) : null,
      charge_amount: liveTransactionSnapshot.preview ? liveTransactionSnapshot.preview.charge_amount : null,
      gst_amount: liveTransactionSnapshot.preview ? liveTransactionSnapshot.preview.gst_amount : null,
      net_amount: liveTransactionSnapshot.preview ? liveTransactionSnapshot.preview.merchant_settlement : null,
      rule_id: liveTransactionSnapshot.rule ? liveTransactionSnapshot.rule.id : null,
      scope: liveTransactionSnapshot.rule ? liveTransactionSnapshot.rule.scope : null,
      settlement_type: liveTransactionSnapshot.rule ? liveTransactionSnapshot.rule.settlement_type : null,
      classification: liveTransactionSnapshot.rule ? liveTransactionSnapshot.rule.card_classification : null,
      match_mode: liveTransactionSnapshot.match_mode,
      result_source: liveTransactionSnapshot.result_source,
    } : {
      amount: amountProvided ? parsedAmount : null,
      charge_percent: null,
      charge_amount: null,
      gst_amount: null,
      net_amount: null,
      rule_id: null,
      scope: null,
      settlement_type: null,
      classification: null,
      match_mode: null,
      result_source: null,
    };

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
      selected_charge: selectedCharge
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

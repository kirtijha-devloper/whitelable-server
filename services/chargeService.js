const db = require('../config/database');

const CARD_BRAND_MAPPINGS = {
  MASTER_CARD: 'MASTERCARD',
  MASTER: 'MASTERCARD',
  MASTERCARD: 'MASTERCARD',
  AMERICAN_EXPRESS: 'AMEX',
  AMEX: 'AMEX',
  DINERS_CLUB: 'DINERS',
  DINERS: 'DINERS'
};

const CARD_BRAND_SYNONYMS = {
  MASTERCARD: ['MASTER_CARD', 'MASTER'],
  AMEX: ['AMERICAN_EXPRESS'],
  DINERS: ['DINERS_CLUB']
};

function normalizeCardBrand(cardBrand) {
  const normalized = String(cardBrand || '').trim().toUpperCase();
  if (!normalized) return null;
  return CARD_BRAND_MAPPINGS[normalized] || normalized;
}

function normalizeLookupValue(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || null;
}

function getCardBrandCandidates(cardBrand) {
  const normalized = normalizeCardBrand(cardBrand);
  if (!normalized) return [];

  const variants = CARD_BRAND_SYNONYMS[normalized] || [];
  const original = String(cardBrand || '').trim().toUpperCase();
  const candidates = [normalized, ...variants];
  if (original && !candidates.includes(original)) {
    candidates.push(original);
  }
  return Array.from(new Set(candidates));
}

async function executeChargeRuleQuery(query, replacementBase, cardBrandCandidates) {
  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      ...replacementBase.slice(0, 4),
      candidate || null,
      ...replacementBase.slice(4)
    ];
    const results = await db.query(query, { bind: replacements, type: db.QueryTypes.SELECT });
    if (results && results.length) return results[0];
  }
  return null;
}

const VALID_SCOPES = [
  'admin_default',
  'admin_franchise',
  'admin_merchant',
  'franchise_default',
  'franchise_merchant'
];

/**
 * Resolve the global admin_default charge rule for a transaction.
 *
 * In the current production mode, only `admin_default` rules are eligible.
 * All merchant/franchise override scopes are ignored for automatic charging.
 * The most specific admin_default row still wins when multiple global rows
 * match the same transaction dimensions.
 *
 * @param {Object}      opts
 * @param {number|null} opts.userId           Merchant/franchise user id
 * @param {number|null} opts.franchiseId      The franchise id (user.franchaise_id)
 * @param {string|null} opts.paymentMode      CARD, UPI, …
 * @param {string|null} opts.cardType         CREDIT, DEBIT, …
 * @param {string|null} opts.cardBrand        VISA, RUPAY, …
 * @param {string|null} opts.classification   CLASSIC, PLATINUM, …
 * @param {string|null} opts.settlement       today_settlement, next_day_settlement, …
 * @param {number}      opts.amount           Transaction amount
 * @returns {Promise<Object|null>}            Best matching rule row, or null
 */
async function getTransactionChargeRule({
  userId,
  franchiseId,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount
}) {
  // Global-only mode: only admin_default rows are eligible.

  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      -- exact matches should outrank scope, so each matched dimension gets a
      -- large multiplier.
      (CASE WHEN UPPER(payment_mode) = $3 THEN 16000 ELSE 0 END) +
      (CASE WHEN settlement_type     = $7 THEN 8000 ELSE 0 END) +
      (CASE WHEN UPPER(card_classification) = $6 THEN 4000 ELSE 0 END) +
      (CASE WHEN UPPER(card_brand)   = $5 THEN 2000 ELSE 0 END) +
      (CASE WHEN UPPER(card_type)    = $4 THEN 1000 ELSE 0 END)
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND scope = 'admin_default'
      AND user_id IS NULL
      AND franchaise_id IS NULL
      -- dimension matching (each is optional in the rule)
      AND (UPPER(payment_mode) = $3 OR payment_mode IS NULL)
      AND (UPPER(card_type)    = $4 OR card_type    IS NULL)
      AND (UPPER(card_brand)   = $5 OR card_brand   IS NULL)
      -- Keep this as an OR check so NULL binds stay type-safe in PostgreSQL.
      AND (UPPER(card_classification) = $6 OR card_classification IS NULL)
      AND (settlement_type     = $7 OR settlement_type     IS NULL)
      -- amount slab
      AND $8 >= min_amount
      AND ($8 <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const exactReplacementBase = [
    userId || null,
    franchiseId || null,
    normalizedPaymentMode,
    normalizedCardType,
    normalizedClassification,
    settlement || null,
    amount
  ];

  if (normalizedClassification) {
    const exactResult = await executeChargeRuleQuery(query, exactReplacementBase, cardBrandCandidates);
    if (exactResult) return exactResult;
  }

  const fallbackReplacementBase = [
    userId || null,
    franchiseId || null,
    normalizedPaymentMode,
    normalizedCardType,
    null,
    settlement || null,
    amount
  ];

  const fallbackResult = await executeChargeRuleQuery(query, fallbackReplacementBase, cardBrandCandidates);
  if (fallbackResult) return fallbackResult;

  return null;
}

/**
 * Resolve the global admin_default rule used for franchise-side calculations.
 *
 * Automatic charging is global-only, so this helper also resolves only
 * `admin_default`.  It is used wherever we need a stable, single system-wide
 * rate.
 */
async function getAdminChargeRuleForFranchise({
  franchiseId,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount
}) {
  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      (CASE WHEN UPPER(payment_mode) = $2 THEN 16000 ELSE 0 END) +
      (CASE WHEN settlement_type     = $6 THEN 8000 ELSE 0 END) +
      (CASE WHEN UPPER(card_classification) = $5 THEN 4000 ELSE 0 END) +
      (CASE WHEN UPPER(card_brand)   = $4 THEN 2000 ELSE 0 END) +
      (CASE WHEN UPPER(card_type)    = $3 THEN 1000 ELSE 0 END)
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND scope = 'admin_default'
      AND user_id IS NULL
      AND franchaise_id IS NULL
      AND (UPPER(payment_mode) = $2 OR payment_mode IS NULL)
      AND (UPPER(card_type)    = $3 OR card_type    IS NULL)
      AND (UPPER(card_brand)   = $4 OR card_brand   IS NULL)
      -- Keep this as an OR check so NULL binds stay type-safe in PostgreSQL.
      AND (UPPER(card_classification) = $5 OR card_classification IS NULL)
      AND (settlement_type     = $6 OR settlement_type     IS NULL)
      AND $7 >= min_amount
      AND ($7 <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const exactReplacementBase = [
    franchiseId || null,
    normalizedPaymentMode,
    normalizedCardType,
    normalizedClassification,
    settlement || null,
    amount
  ];

  if (normalizedClassification) {
    const exactResult = await executeChargeRuleQuery(query, exactReplacementBase, cardBrandCandidates);
    if (exactResult) return exactResult;
  }

  const fallbackReplacementBase = [
    franchiseId || null,
    normalizedPaymentMode,
    normalizedCardType,
    null,
    settlement || null,
    amount
  ];

  const fallbackResult = await executeChargeRuleQuery(query, fallbackReplacementBase, cardBrandCandidates);
  if (fallbackResult) return fallbackResult;

  return null;
}

/**
 * Calculate the actual charge amount given transaction amount and a matching rule.
 *
 * @param {number} amount
 * @param {Object} rule
 * @returns {{ charge: number, gstAmount: number }}
 */
function calculateCharge(amount, rule) {
  if (!rule) return { charge: 0, gstAmount: 0 };
  const percentCharge = parseFloat(amount) * (parseFloat(rule.charge_percent) / 100);
  const flatCharge = rule.charge_flat ? parseFloat(rule.charge_flat) : 0;
  const charge = parseFloat((percentCharge + flatCharge).toFixed(2));
  let gstAmount = 0;
  if (rule.gst_required && rule.gst_percent && parseFloat(rule.gst_percent) > 0) {
    gstAmount = parseFloat((charge * (parseFloat(rule.gst_percent) / 100)).toFixed(2));
  }
  return { charge, gstAmount };
}

/**
 * Derive the correct scope value from the caller's role and the target ids.
 *
 * @param {string}      callerRole    'admin' | 'franchaise' | 'franchise'
 * @param {number|null} userId        target merchant id (null → default rule)
 * @param {number|null} franchiseId   target franchise id
 * @returns {string}                  one of VALID_SCOPES
 */
function deriveScope(callerRole, userId, franchiseId) {
  const isAdmin = callerRole === 'admin';

  if (isAdmin) {
    if (userId)      return 'admin_merchant';
    if (franchiseId) return 'admin_franchise';
    return 'admin_default';
  }

  // franchise caller
  if (userId) return 'franchise_merchant';
  return 'franchise_default';
}

module.exports = {
  VALID_SCOPES,
  getTransactionChargeRule,
  getAdminChargeRuleForFranchise,
  calculateCharge,
  deriveScope,
  normalizeLookupValue,
  normalizeCardBrand,
  getCardBrandCandidates
};

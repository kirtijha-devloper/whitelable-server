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

const VALID_SCOPES = [
  'admin_default',
  'admin_franchise',
  'admin_merchant',
  'franchise_default',
  'franchise_merchant'
];

/**
 * Resolve the best-matching charge rule for a transaction.
 *
 * Resolution order (highest wins):
 *   franchise_merchant  → franchise set a rate for THIS merchant
 *   admin_merchant      → admin set a rate for THIS non-franchised merchant
 *   franchise_default   → franchise default for all its merchants
 *   admin_franchise     → admin rate for the franchise
 *   admin_default       → global fall-back
 *
 * Within the same scope tier the query further ranks by how many optional
 * dimensions (settlement_type, card_classification, card_brand, card_type) are
 * matched — a more specific combination beats a less specific one.
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
  // Scope tier weights — determines precedence between rule origins.
  // Within the same tier, optional-dimension specificity (0-15) breaks ties.
  //
  //   franchise_merchant  64    (franchise set rate for a specific merchant)
  //   admin_merchant      48    (admin set rate for a specific non-franchised merchant)
  //   franchise_default   32    (franchise default for all its merchants)
  //   admin_franchise     16    (admin set rate for a franchise)
  //   admin_default        0    (global default)

  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      -- scope tier weight
      CASE scope
        WHEN 'franchise_merchant' THEN 64
        WHEN 'admin_merchant'     THEN 48
        WHEN 'franchise_default'  THEN 32
        WHEN 'admin_franchise'    THEN 16
        ELSE 0
      END
      +
      -- optional-dimension specificity within the tier
      (CASE WHEN settlement_type IS NOT NULL THEN 8 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL THEN 4 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL THEN 2 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL THEN 1 ELSE 0 END)
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      -- scope-aware row filtering: only pull in rows that CAN apply
      AND (
            -- user-specific rules (admin_merchant or franchise_merchant)
            (user_id = $1)
            -- franchise-level or global (no user_id)
         OR (user_id IS NULL AND (franchaise_id = $2 OR franchaise_id IS NULL))
      )
      -- dimension matching (each is optional in the rule)
      AND (payment_mode = $3 OR payment_mode IS NULL)
      AND (card_type    = $4 OR card_type    IS NULL)
      AND (card_brand   = $5 OR card_brand   IS NULL)
      AND (card_classification = $6 OR card_classification IS NULL)
      AND (settlement_type     = $7 OR settlement_type     IS NULL)
      -- amount slab
      AND $8 >= min_amount
      AND ($8 <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const replacementBase = [
    userId || null,
    franchiseId || null,
    paymentMode || null,
    cardType || null,
    classification || null,
    settlement || null,
    amount
  ];

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

/**
 * Resolve the admin-level charge that a franchise owes the platform.
 *
 * This only looks at rules scoped to: admin_franchise (for the given franchise)
 * or admin_default.  It explicitly excludes any franchise-created rules so that
 * franchise adjustments for merchants do not influence what the franchise owes.
 *
 * Used in the webhook worker to compute franchise earnings.
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
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      CASE scope
        WHEN 'admin_franchise' THEN 16
        ELSE 0
      END
      +
      (CASE WHEN settlement_type IS NOT NULL THEN 8 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL THEN 4 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL THEN 2 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL THEN 1 ELSE 0 END)
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND scope IN ('admin_franchise', 'admin_default')
      AND user_id IS NULL
      AND (franchaise_id = $1 OR franchaise_id IS NULL)
      AND (payment_mode = $2 OR payment_mode IS NULL)
      AND (card_type    = $3 OR card_type    IS NULL)
      AND (card_brand   = $4 OR card_brand   IS NULL)
      AND (card_classification = $5 OR card_classification IS NULL)
      AND (settlement_type     = $6 OR settlement_type     IS NULL)
      AND $7 >= min_amount
      AND ($7 <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const replacementBase = [
    franchiseId || null,
    paymentMode || null,
    cardType || null,
    classification || null,
    settlement || null,
    amount
  ];

  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      replacementBase[0],
      replacementBase[1],
      replacementBase[2],
      candidate || null,
      replacementBase[3],
      replacementBase[4],
      replacementBase[5]
    ];
    const results = await db.query(query, { bind: replacements, type: db.QueryTypes.SELECT });
    if (results && results.length) return results[0];
  }
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
  normalizeCardBrand,
  getCardBrandCandidates
};

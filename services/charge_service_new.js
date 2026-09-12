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
      replacementBase[0],
      replacementBase[1],
      candidate || null,
      replacementBase[2],
      replacementBase[3],
      replacementBase[4]
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
  // Exact dimension matches outrank scope. Scope only breaks ties after the
  // rule has matched the requested payment/card/settlement fields.
  //
  //   franchise_merchant  64    (franchise set rate for a specific merchant)
  //   admin_merchant      48    (admin set rate for a specific non-franchised merchant)
  //   franchise_default   32    (franchise default for all its merchants)
  //   admin_franchise     16    (admin set rate for a franchise)
  //   admin_default        0    (global default)

  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      -- exact matches should outrank scope, so each matched dimension gets a
      -- large multiplier.
      (CASE WHEN UPPER(payment_mode) = $1 THEN 16000 ELSE 0 END) +
      (CASE WHEN UPPER(card_type)    = $2 THEN 1000 ELSE 0 END) +
      (CASE WHEN UPPER(card_brand)   = $3 THEN 2000 ELSE 0 END) +
      (CASE WHEN UPPER(card_classification) = $4 THEN 4000 ELSE 0 END) +
      (CASE WHEN settlement_type     = $5 THEN 8000 ELSE 0 END)
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND scope = 'admin_default'
      AND user_id IS NULL
      AND franchaise_id IS NULL
      -- dimension matching (each is optional in the rule)
      AND (UPPER(payment_mode) = $1 OR payment_mode IS NULL)
      AND (UPPER(card_type)    = $2 OR card_type    IS NULL)
      AND (UPPER(card_brand)   = $3 OR card_brand   IS NULL)
      -- Keep this as an OR check so NULL binds stay type-safe in PostgreSQL.
      AND (UPPER(card_classification) = $4 OR card_classification IS NULL)
      AND (settlement_type     = $5 OR settlement_type     IS NULL)
      -- amount slab
      AND $6 >= min_amount
      AND ($6 <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const exactReplacementBase = [
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
  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      (CASE WHEN UPPER(payment_mode) = $1 THEN 16000 ELSE 0 END) +
      (CASE WHEN UPPER(card_type)    = $2 THEN 1000 ELSE 0 END) +
      (CASE WHEN UPPER(card_brand)   = $3 THEN 2000 ELSE 0 END) +
      (CASE WHEN UPPER(card_classification) = $4 THEN 4000 ELSE 0 END) +
      (CASE WHEN settlement_type     = $5 THEN 8000 ELSE 0 END)
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND scope = 'admin_default'
      AND user_id IS NULL
      AND franchaise_id IS NULL
      AND (UPPER(payment_mode) = $1 OR payment_mode IS NULL)
      AND (UPPER(card_type)    = $2 OR card_type    IS NULL)
      AND (UPPER(card_brand)   = $3 OR card_brand   IS NULL)
      -- Keep this as an OR check so NULL binds stay type-safe in PostgreSQL.
      AND (UPPER(card_classification) = $4 OR card_classification IS NULL)
      AND (settlement_type     = $5 OR settlement_type     IS NULL)
      AND $6 >= min_amount
      AND ($6 <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const exactReplacementBase = [
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

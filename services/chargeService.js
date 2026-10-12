
const db = require('../config/database');

const CARD_BRAND_MAPPINGS = {
  MASTER_CARD: 'MASTERCARD',
  'MASTER CARD': 'MASTERCARD',
  MASTER: 'MASTERCARD',
  MASTERCARD: 'MASTERCARD',
  AMERICAN_EXPRESS: 'AMEX',
  'AMERICAN EXPRESS': 'AMEX',
  AMEX: 'AMEX',
  DINERS_CLUB: 'DINERS',
  'DINERS CLUB': 'DINERS',
  DINERSCLUB: 'DINERS',
  DINERCLUB: 'DINERS',
  'DINER CLUB': 'DINERS',
  DINER_CLUB: 'DINERS',
  DINERS: 'DINERS'
};

const CARD_BRAND_SYNONYMS = {
  MASTERCARD: ['MASTER_CARD', 'MASTER', 'MASTER CARD'],
  AMEX: ['AMERICAN_EXPRESS', 'AMERICAN EXPRESS'],
  DINERS: ['DINERS_CLUB', 'DINERS CLUB', 'DINERSCLUB', 'DINERCLUB', 'DINER CLUB', 'DINER_CLUB']
};

function normalizeCardBrand(cardBrand) {
  if (!cardBrand) return null;
  const normalized = String(cardBrand).trim().toUpperCase();
  const cleanWithSpace = normalized.replace(/[\s_-]+/g, ' ');
  const cleanWithUnderscore = normalized.replace(/[\s_-]+/g, '_');
  
  return CARD_BRAND_MAPPINGS[normalized] || 
         CARD_BRAND_MAPPINGS[cleanWithSpace] || 
         CARD_BRAND_MAPPINGS[cleanWithUnderscore] || 
         normalized;
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

const VALID_SCOPES = [
  'super_admin_default',
  'super_admin_admin',
  'admin_default',
  'admin_super_franchise',
  'super_franchise_franchise',
  'super_franchise_default',
  'super_franchise_merchant',
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
 * @param {string|null} opts.userRole         merchant | franchaise | franchise
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
  userRole,
  franchiseId,
  superFranchiseId,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount,
  companyName
}) {
  // Scope tier weights — determines precedence between rule origins.
  // Within the same tier, optional-dimension specificity (0-15) breaks ties.
  //
  //   franchise_merchant  64    (franchise set rate for a specific merchant)
  //   admin_merchant      48    (admin set rate for a specific non-franchised merchant)
  //   franchise_default   32    (franchise default for all its merchants)
  //   admin_franchise     16    (admin set rate for a franchise)
  //   admin_default        0    (global default)

  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const normalizedUserRole = normalizeLookupValue(userRole);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      (CASE WHEN company_name IS NOT NULL AND UPPER(company_name) != 'ANY' THEN 32000 ELSE 0 END) +
      (CASE WHEN payment_mode IS NOT NULL AND UPPER(payment_mode) != 'ANY' THEN 16000 ELSE 0 END) +
      (CASE WHEN settlement_type IS NOT NULL AND UPPER(settlement_type) != 'ANY' THEN 8000 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL AND UPPER(card_classification) != 'ANY' AND UPPER(card_classification) != 'NULL' THEN 4000 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL AND UPPER(card_brand) != 'ANY' THEN 2000 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL AND UPPER(card_type) != 'ANY' THEN 1000 ELSE 0 END) +
      CASE scope
        WHEN 'super_admin_admin'         THEN 96
        WHEN 'super_admin_default'       THEN 90
        WHEN 'super_franchise_merchant'  THEN 80
        WHEN 'franchise_merchant'        THEN 64
        WHEN 'admin_merchant'            THEN 48
        WHEN 'super_franchise_franchise' THEN 40
        WHEN 'super_franchise_default'   THEN 36
        WHEN 'franchise_default'         THEN 32
        WHEN 'admin_super_franchise'     THEN 24
        WHEN 'admin_franchise'           THEN 16
        ELSE 0
      END
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      -- scope-aware row filtering: only pull in rows that CAN apply
      AND (
            -- User-specific rule matches target merchant/user directly
            ($1::integer IS NOT NULL AND user_id = $1::integer)
            -- Franchise/super-franchise level or global default (no user_id)
         OR (user_id IS NULL
             AND ($2::integer IS NULL OR franchaise_id = $2::integer OR franchaise_id IS NULL)
             AND (super_franchise_id IS NULL OR ($10::integer IS NOT NULL AND super_franchise_id = $10::integer))
         )
      )
      -- dimension matching (each is optional in the rule)
      AND ($3::text IS NULL OR UPPER(payment_mode) = UPPER($3::text) OR payment_mode IS NULL OR UPPER(payment_mode) = 'ANY')
      AND ($4::text IS NULL OR UPPER(card_type)    = UPPER($4::text)    OR card_type    IS NULL OR UPPER(card_type)    = 'ANY')
      AND ($5::text IS NULL OR UPPER(card_brand)   = UPPER($5::text)   OR card_brand   IS NULL OR UPPER(card_brand)   = 'ANY')
      -- When $6 (classification) is NULL, only match rules whose classification is NULL or 'ANY'.
      -- When $6 is provided, match rules whose classification equals $6, is NULL, or is 'ANY'.
      AND (($6::text IS NOT NULL AND UPPER(card_classification) = UPPER($6::text)) OR card_classification IS NULL OR UPPER(card_classification) = 'ANY' OR UPPER(card_classification) = 'NULL')
      -- Same treatment for settlement: when $7 is NULL, only match NULL or 'ANY' settlement rules.
      AND (
        $7::text IS NULL
        OR settlement_type IS NULL
        OR UPPER(settlement_type) = 'ANY'
        OR settlement_type = $7::text
        OR ($7::text IN ('T0', 'today_settlement') AND settlement_type IN ('T0', 'today_settlement'))
        OR ($7::text IN ('T1', 'next_day_settlement') AND settlement_type IN ('T1', 'next_day_settlement'))
      )
      -- amount slab
      AND $8::numeric >= min_amount
      AND ($8::numeric <= max_amount OR max_amount IS NULL)
      -- company_name match
      AND (($9::text IS NOT NULL AND UPPER(company_name) = UPPER($9::text)) OR company_name IS NULL OR UPPER(company_name) = 'ANY')
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const replacementBase = [
    userId ? parseInt(userId, 10) : null,
    franchiseId ? parseInt(franchiseId, 10) : null,
    normalizedPaymentMode,
    normalizedCardType,
    normalizedClassification,
    settlement || null,
    amount != null ? parseFloat(amount) : 0,
    normalizeLookupValue(companyName),
    superFranchiseId ? parseInt(superFranchiseId, 10) : null
  ];

  let bestRule = null;
  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      ...replacementBase.slice(0, 4),
      candidate || null,
      ...replacementBase.slice(4)
    ];
    const results = await db.query(query, { bind: replacements, type: db.QueryTypes.SELECT });
    if (results && results.length) {
      const candidateRule = results[0];
      if (!bestRule || candidateRule.specificity > bestRule.specificity) {
        bestRule = candidateRule;
      }
    }
  }
  return bestRule;
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
  superFranchiseId,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount,
  companyName
}) {
  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      (CASE WHEN company_name IS NOT NULL AND UPPER(company_name) != 'ANY' THEN 32000 ELSE 0 END) +
      (CASE WHEN payment_mode IS NOT NULL AND UPPER(payment_mode) != 'ANY' THEN 16000 ELSE 0 END) +
      (CASE WHEN settlement_type IS NOT NULL AND UPPER(settlement_type) != 'ANY' THEN 8000 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL AND UPPER(card_classification) != 'ANY' AND UPPER(card_classification) != 'NULL' THEN 4000 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL AND UPPER(card_brand) != 'ANY' THEN 2000 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL AND UPPER(card_type) != 'ANY' THEN 1000 ELSE 0 END) +
      CASE scope
        WHEN 'super_franchise_franchise' THEN 40
        WHEN 'super_franchise_default'   THEN 36
        WHEN 'admin_franchise'           THEN 16
        ELSE 0
      END
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND scope IN ('super_franchise_franchise', 'super_franchise_default', 'admin_franchise', 'admin_default')
      AND user_id IS NULL
      AND (
        (scope = 'super_franchise_franchise' AND super_franchise_id = $9 AND franchaise_id = $1)
        OR (scope = 'super_franchise_default' AND super_franchise_id = $9 AND franchaise_id IS NULL)
        OR (scope IN ('admin_franchise', 'admin_default') AND (franchaise_id = $1 OR franchaise_id IS NULL))
      )
      AND (UPPER(payment_mode) = $2 OR payment_mode IS NULL OR UPPER(payment_mode) = 'ANY')
      AND (UPPER(card_type)    = $3 OR card_type    IS NULL OR UPPER(card_type)    = 'ANY')
      AND (UPPER(card_brand)   = $4 OR card_brand   IS NULL OR UPPER(card_brand)   = 'ANY')
      AND (($5::text IS NOT NULL AND UPPER(card_classification) = UPPER($5::text)) OR card_classification IS NULL OR UPPER(card_classification) = 'ANY' OR UPPER(card_classification) = 'NULL')
      AND (
        $6::text IS NULL
        OR settlement_type IS NULL
        OR UPPER(settlement_type) = 'ANY'
        OR settlement_type = $6::text
        OR ($6::text IN ('T0', 'today_settlement') AND settlement_type IN ('T0', 'today_settlement'))
        OR ($6::text IN ('T1', 'next_day_settlement') AND settlement_type IN ('T1', 'next_day_settlement'))
      )
      AND (($8::text IS NOT NULL AND UPPER(company_name) = UPPER($8::text)) OR company_name IS NULL OR UPPER(company_name) = 'ANY')
      AND $7 >= min_amount
      AND ($7 <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const replacementBase = [
    franchiseId || null,
    normalizedPaymentMode,
    normalizedCardType,
    normalizedClassification,
    settlement || null,
    amount,
    normalizeLookupValue(companyName),
    superFranchiseId || null
  ];

  let bestRule = null;
  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      replacementBase[0],       // $1 franchiseId
      replacementBase[1],       // $2 paymentMode
      replacementBase[2],       // $3 cardType
      candidate || null,        // $4 cardBrand (per-loop)
      replacementBase[3],       // $5 classification
      replacementBase[4],       // $6 settlement
      replacementBase[5],       // $7 amount
      replacementBase[6],       // $8 companyName
      replacementBase[7]        // $9 superFranchiseId
    ];
    const results = await db.query(query, { bind: replacements, type: db.QueryTypes.SELECT });
    if (results && results.length) {
      const candidateRule = results[0];
      if (!bestRule || candidateRule.specificity > bestRule.specificity) {
        bestRule = candidateRule;
      }
    }
  }
  return bestRule;
}

/**
 * Resolve the admin-level charge that a super franchise owes the platform.
 *
 * This only looks at rules scoped to: admin_super_franchise (for the given
 * super franchise) or admin_default.  It explicitly excludes franchise-created
 * and super-franchise-created rules so that downstream adjustments do not
 * influence what the super franchise owes.
 *
 * Used in the webhook worker to compute super franchise earnings.
 */
async function getAdminChargeRuleForSuperFranchise({
  superFranchiseId,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount,
  companyName
}) {
  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      (CASE WHEN company_name IS NOT NULL AND UPPER(company_name) != 'ANY' THEN 32000 ELSE 0 END) +
      (CASE WHEN payment_mode IS NOT NULL AND UPPER(payment_mode) != 'ANY' THEN 16000 ELSE 0 END) +
      (CASE WHEN settlement_type IS NOT NULL AND UPPER(settlement_type) != 'ANY' THEN 8000 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL AND UPPER(card_classification) != 'ANY' AND UPPER(card_classification) != 'NULL' THEN 4000 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL AND UPPER(card_brand) != 'ANY' THEN 2000 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL AND UPPER(card_type) != 'ANY' THEN 1000 ELSE 0 END) +
      CASE scope
        WHEN 'admin_super_franchise' THEN 24
        ELSE 0
      END
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND scope IN ('admin_super_franchise', 'admin_default')
      AND user_id IS NULL
      AND franchaise_id IS NULL
      AND (super_franchise_id = $1 OR super_franchise_id IS NULL)
      AND (UPPER(payment_mode) = $2 OR payment_mode IS NULL OR UPPER(payment_mode) = 'ANY')
      AND (UPPER(card_type)    = $3 OR card_type    IS NULL OR UPPER(card_type)    = 'ANY')
      AND (UPPER(card_brand)   = $4 OR card_brand   IS NULL OR UPPER(card_brand)   = 'ANY')
      AND (($5::text IS NOT NULL AND UPPER(card_classification) = UPPER($5::text)) OR card_classification IS NULL OR UPPER(card_classification) = 'ANY' OR UPPER(card_classification) = 'NULL')
      AND (
        $6::text IS NULL
        OR settlement_type IS NULL
        OR UPPER(settlement_type) = 'ANY'
        OR settlement_type = $6::text
        OR ($6::text IN ('T0', 'today_settlement') AND settlement_type IN ('T0', 'today_settlement'))
        OR ($6::text IN ('T1', 'next_day_settlement') AND settlement_type IN ('T1', 'next_day_settlement'))
      )
      AND (($8::text IS NOT NULL AND UPPER(company_name) = UPPER($8::text)) OR company_name IS NULL OR UPPER(company_name) = 'ANY')
      AND $7 >= min_amount
      AND ($7 <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const replacementBase = [
    superFranchiseId || null,
    normalizedPaymentMode,
    normalizedCardType,
    normalizedClassification,
    settlement || null,
    amount,
    normalizeLookupValue(companyName)
  ];

  let bestRule = null;
  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      replacementBase[0],       // $1 superFranchiseId
      replacementBase[1],       // $2 paymentMode
      replacementBase[2],       // $3 cardType
      candidate || null,        // $4 cardBrand (per-loop)
      replacementBase[3],       // $5 classification
      replacementBase[4],       // $6 settlement
      replacementBase[5],       // $7 amount
      replacementBase[6]        // $8 companyName
    ];
    const results = await db.query(query, { bind: replacements, type: db.QueryTypes.SELECT });
    if (results && results.length) {
      const candidateRule = results[0];
      if (!bestRule || candidateRule.specificity > bestRule.specificity) {
        bestRule = candidateRule;
      }
    }
  }
  return bestRule;
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
 * @param {string}      callerRole        'admin' | 'super_franchise' | 'franchaise' | 'franchise'
 * @param {number|null} userId            target merchant id (null → default rule)
 * @param {number|null} franchiseId       target franchise id
 * @param {number|null} superFranchiseId  target super franchise id
 * @returns {string}                      one of VALID_SCOPES
 */
function deriveScope(callerRole, userId, franchiseId, superFranchiseId) {
  const normalizedCaller = callerRole === 'franchise' ? 'franchaise' : callerRole;

  if (normalizedCaller === 'super_admin') {
    if (userId) return 'super_admin_admin';
    return 'super_admin_default';
  }

  if (normalizedCaller === 'admin') {
    if (userId) return 'admin_merchant';
    if (franchiseId) return 'admin_franchise';
    if (superFranchiseId) return 'admin_super_franchise';
    return 'admin_default';
  }

  if (normalizedCaller === 'super_franchise') {
    if (userId) return 'super_franchise_merchant';
    if (franchiseId) return 'super_franchise_franchise';
    return 'super_franchise_default';
  }

  // franchise caller
  if (userId) return 'franchise_merchant';
  return 'franchise_default';
}

module.exports = {
  VALID_SCOPES,
  getTransactionChargeRule,
  getAdminChargeRuleForFranchise,
  getAdminChargeRuleForSuperFranchise,
  calculateCharge,
  deriveScope,
  normalizeLookupValue,
  normalizeCardBrand,
  getCardBrandCandidates
};

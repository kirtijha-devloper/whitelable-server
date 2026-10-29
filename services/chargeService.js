
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
 * @returns {Promise<Object|null>}            Best matching rule row, or null
 */
async function getTransactionChargeRule({
  userId,
  userRole,
  franchiseId,
  superFranchiseId,
  companyId,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount,
  companyName
}) {
  // Automatically resolve missing hierarchy IDs from User record if userId is provided
  if (userId) {
    try {
      const dbUser = await db.models.User.findByPk(userId, {
        attributes: ['id', 'role', 'franchaise_id', 'super_franchise_id', 'company_id']
      });
      if (dbUser) {
        if (!userRole) userRole = dbUser.role;
        if (!franchiseId) franchiseId = dbUser.franchaise_id;
        if (!superFranchiseId) superFranchiseId = dbUser.super_franchise_id;
        if (!companyId) companyId = dbUser.company_id;
      }
    } catch (e) {
      // ignore lookup error
    }
  }
  if (franchiseId && !superFranchiseId) {
    try {
      const dbFranchise = await db.models.User.findByPk(franchiseId, {
        attributes: ['id', 'super_franchise_id', 'company_id']
      });
      if (dbFranchise) {
        if (!superFranchiseId) superFranchiseId = dbFranchise.super_franchise_id;
        if (!companyId) companyId = dbFranchise.company_id;
      }
    } catch (e) {
      // ignore lookup error
    }
  }

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
        WHEN 'franchise_merchant'        THEN 1100000
        WHEN 'super_franchise_merchant'  THEN 1000000
        WHEN 'admin_merchant'            THEN 900000
        WHEN 'franchise_default'         THEN 600000
        WHEN 'super_franchise_franchise' THEN 550000
        WHEN 'super_franchise_default'   THEN 500000
        WHEN 'admin_franchise'           THEN 400000
        WHEN 'admin_super_franchise'     THEN 350000
        WHEN 'admin_default'             THEN 200000
        WHEN 'super_admin_admin'         THEN 150000
        WHEN 'super_admin_default'       THEN 100000
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
             AND ($11::text IS NULL OR company_id IS NULL OR company_id = $11::text)
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
    superFranchiseId ? parseInt(superFranchiseId, 10) : null,
    companyId ? String(companyId).trim() : null
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
 * Universal Charge Rule Resolver
 * Fulfills all duties:
 * 1. Accepts flexible input options (userId, user object, paymentMode, cardType, cardBrand, settlement, amount, etc.)
 * 2. Automatically resolves missing user hierarchy (userRole, franchaise_id, super_franchise_id, company_id) if only userId is supplied.
 * 3. Normalizes card brand, payment mode, and settlement (T0 vs T1).
 * 4. Resolves the most specific matching charge rule across all hierarchical scopes.
 * 5. Provides fallback to baseline default rule if no custom rule exists.
 *
 * @param {Object} opts
 * @returns {Promise<Object>} The resolved charge rule row (or default fallback rule)
 */
async function getChargeRule(opts = {}) {
  let {
    userId,
    user,
    userRole,
    franchiseId,
    superFranchiseId,
    companyId,
    companyName,
    paymentMode,
    cardType,
    cardBrand,
    classification,
    settlement,
    amount
  } = opts;

  // If user object is provided directly
  if (user && typeof user === 'object') {
    if (!userId) userId = user.id;
    if (!userRole) userRole = user.role;
    if (!franchiseId) franchiseId = user.franchaise_id || user.franchise_id;
    if (!superFranchiseId) superFranchiseId = user.super_franchise_id;
    if (!companyId) companyId = user.company_id;
  }

  // Auto-resolve missing user hierarchy from User model
  if (userId && (!userRole || !companyId || (franchiseId === undefined && superFranchiseId === undefined))) {
    try {
      const dbUser = await db.models.User.findByPk(userId, {
        attributes: ['id', 'role', 'franchaise_id', 'super_franchise_id', 'company_id']
      });
      if (dbUser) {
        if (!userRole) userRole = dbUser.role;
        if (!franchiseId) franchiseId = dbUser.franchaise_id;
        if (!superFranchiseId) superFranchiseId = dbUser.super_franchise_id;
        if (!companyId) companyId = dbUser.company_id;
      }
    } catch (e) {
      // ignore lookup error
    }
  }

  // Map alternative parameter aliases
  const resolvedPaymentMode = paymentMode || opts.paymentMethod || opts.txn_type || 'CRDB';
  const resolvedCardType = cardType || opts.paymentCardType || 'CREDIT';
  const resolvedCardBrand = cardBrand || opts.paymentCardBrand || opts.card_scheme || 'VISA';
  const resolvedClassification = classification || opts.cardClassification || opts.card_classification || null;
  const resolvedSettlement = settlement || opts.settlementType || opts.settlement_type || null;
  const resolvedAmount = amount != null ? parseFloat(amount) : (opts.transactionAmount != null ? parseFloat(opts.transactionAmount) : 0);

  // Call the core specificity-ranked transaction rule resolver
  const rule = await getTransactionChargeRule({
    userId,
    userRole,
    franchiseId,
    superFranchiseId,
    companyId,
    paymentMode: resolvedPaymentMode,
    cardType: resolvedCardType,
    cardBrand: resolvedCardBrand,
    classification: resolvedClassification,
    settlement: resolvedSettlement,
    amount: resolvedAmount,
    companyName
  });

  if (rule) {
    return rule;
  }

  // If no specific or default rule matched in the database, return a safe platform default MDR
  const defaultMdr = 2.5;
  return {
    id: null,
    scope: 'super_admin_default',
    charge_percent: defaultMdr,
    charge_flat: 0,
    gst_required: false,
    gst_percent: 0,
    is_active: true,
    is_fallback: true
  };
}

/**
 * Resolve the admin-level charge that a franchise owes the platform.
 *
 * This only looks at rules scoped to: super_franchise_franchise, super_franchise_default,
 * admin_franchise, admin_default, or super_admin_default.
 *
 * Used in the webhook worker to compute franchise earnings.
 */
async function getAdminChargeRuleForFranchise({
  franchiseId,
  superFranchiseId,
  companyId,
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
        WHEN 'super_franchise_franchise' THEN 550000
        WHEN 'super_franchise_default'   THEN 500000
        WHEN 'admin_franchise'           THEN 400000
        WHEN 'admin_default'             THEN 200000
        WHEN 'super_admin_default'       THEN 100000
        ELSE 0
      END
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND scope IN ('super_franchise_franchise', 'super_franchise_default', 'admin_franchise', 'admin_default', 'super_admin_default')
      AND user_id IS NULL
      AND (
        (scope = 'super_franchise_franchise' AND super_franchise_id = $9 AND franchaise_id = $1)
        OR (scope = 'super_franchise_default' AND super_franchise_id = $9 AND franchaise_id IS NULL)
        OR (scope IN ('admin_franchise', 'admin_default', 'super_admin_default') AND (franchaise_id = $1 OR franchaise_id IS NULL))
      )
      AND ($10::text IS NULL OR company_id IS NULL OR company_id = $10::text)
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
    superFranchiseId || null,
    companyId ? String(companyId).trim() : null
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
      replacementBase[7],       // $9 superFranchiseId
      replacementBase[8]        // $10 companyId
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
 * Scopes: admin_super_franchise, admin_default, or super_admin_default.
 * Used in the webhook worker to compute super franchise earnings.
 */
async function getAdminChargeRuleForSuperFranchise({
  superFranchiseId,
  companyId,
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
        WHEN 'admin_default'         THEN 16
        WHEN 'super_admin_default'   THEN 8
        ELSE 0
      END
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND scope IN ('admin_super_franchise', 'admin_default', 'super_admin_default')
      AND user_id IS NULL
      AND franchaise_id IS NULL
      AND (super_franchise_id = $1 OR super_franchise_id IS NULL)
      AND ($9::text IS NULL OR company_id IS NULL OR company_id = $9::text)
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
    normalizeLookupValue(companyName),
    companyId ? String(companyId).trim() : null
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
      replacementBase[6],       // $8 companyName
      replacementBase[7]        // $9 companyId
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
 * Resolve the platform-level charge that an admin owes to Super Admin.
 *
 * Scopes:
 *   - super_admin_admin (override for the specific admin user)
 *   - super_admin_default (global platform baseline)
 */
async function getSuperAdminChargeRuleForAdmin({
  adminId,
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
        WHEN 'super_admin_admin'   THEN 24
        WHEN 'super_admin_default' THEN 8
        ELSE 0
      END
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND scope IN ('super_admin_admin', 'super_admin_default')
      AND (
        ($1::integer IS NOT NULL AND user_id = $1::integer AND scope = 'super_admin_admin')
        OR (user_id IS NULL AND scope = 'super_admin_default')
      )
      AND ($2::text IS NULL OR UPPER(payment_mode) = UPPER($2::text) OR payment_mode IS NULL OR UPPER(payment_mode) = 'ANY')
      AND ($3::text IS NULL OR UPPER(card_type)    = UPPER($3::text)    OR card_type    IS NULL OR UPPER(card_type)    = 'ANY')
      AND ($4::text IS NULL OR UPPER(card_brand)   = UPPER($4::text)   OR card_brand   IS NULL OR UPPER(card_brand)   = 'ANY')
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
      AND $7::numeric >= min_amount
      AND ($7::numeric <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const replacementBase = [
    adminId ? parseInt(adminId, 10) : null,
    normalizedPaymentMode,
    normalizedCardType,
    normalizedClassification,
    settlement || null,
    amount != null ? parseFloat(amount) : 0,
    normalizeLookupValue(companyName)
  ];

  let bestRule = null;
  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      replacementBase[0],       // $1 adminId
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
 * @param {string|null} targetRole        optional target user role ('super_franchise'|'franchaise'|'merchant')
 * @returns {string}                      one of VALID_SCOPES
 */
function deriveScope(callerRole, userId, franchiseId, superFranchiseId, targetRole = null) {
  const normalizedCaller = callerRole === 'franchise' ? 'franchaise' : callerRole;
  const normalizedTarget = targetRole === 'franchise' ? 'franchaise' : targetRole;

  if (normalizedCaller === 'super_admin') {
    if (userId) return 'super_admin_admin';
    return 'super_admin_default';
  }

  if (normalizedCaller === 'admin') {
    if (userId) return 'admin_merchant';
    if (normalizedTarget === 'super_franchise' || (superFranchiseId && !franchiseId)) {
      return 'admin_super_franchise';
    }
    if (normalizedTarget === 'franchaise' || franchiseId) {
      return 'admin_franchise';
    }
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
  getChargeRule,
  getTransactionChargeRule,
  getAdminChargeRuleForFranchise,
  getAdminChargeRuleForSuperFranchise,
  getSuperAdminChargeRuleForAdmin,
  calculateCharge,
  deriveScope,
  normalizeLookupValue,
  normalizeCardBrand,
  getCardBrandCandidates
};

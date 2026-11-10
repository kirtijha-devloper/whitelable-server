const db = require('../config/database');
const PgChargeRule = require('../models/PgChargeRule');
const User = require('../models/User');

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

function normalizeGatewayValue(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'all' ? null : normalized;
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
 * 1. MERCHANT / TRANSACTION LEVEL QUERY
 * Resolves the best-matching PG charge rule for a transaction.
 *
 * Chronological order (highest specificity score wins):
 *   1.  franchise_merchant        (1,200,000)
 *   2.  franchise_default         (1,100,000)
 *   3.  super_franchise_merchant  (1,000,000)
 *   4.  super_franchise_franchise (  900,000)
 *   5.  super_franchise_default   (  800,000)
 *   6.  admin_merchant            (  700,000)
 *   7.  admin_franchise           (  600,000)
 *   8.  admin_super_franchise     (  500,000)
 *   9.  admin_default             (  400,000)
 *   10. super_admin_admin         (  300,000)
 *   11. super_admin_default       (  200,000)
 */
async function getTransactionChargeRule({
  userId,
  userRole,
  franchiseId,
  superFranchiseId,
  companyId,
  adminId,
  gateway,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount,
  companyName
}) {
  // Automatically resolve missing hierarchy IDs from User record
  if (userId) {
    try {
      const dbUser = await db.models.User.findByPk(userId, {
        attributes: ['id', 'role', 'franchaise_id', 'super_franchise_id', 'company_id', 'admin_id']
      });
      if (dbUser) {
        if (!userRole) userRole = dbUser.role;
        if (!franchiseId) franchiseId = dbUser.franchaise_id;
        if (!superFranchiseId) superFranchiseId = dbUser.super_franchise_id;
        if (!companyId) companyId = dbUser.company_id;
        if (!adminId) adminId = dbUser.role === 'admin' ? dbUser.id : dbUser.admin_id;
      }
    } catch (e) {
      // ignore lookup error
    }
  }

  if (franchiseId && (!superFranchiseId || !companyId || !adminId)) {
    try {
      const dbFranchise = await db.models.User.findByPk(franchiseId, {
        attributes: ['id', 'super_franchise_id', 'company_id', 'admin_id']
      });
      if (dbFranchise) {
        if (!superFranchiseId) superFranchiseId = dbFranchise.super_franchise_id;
        if (!companyId) companyId = dbFranchise.company_id;
        if (!adminId) adminId = dbFranchise.admin_id;
      }
    } catch (e) {
      // ignore lookup error
    }
  }

  if (!adminId && companyId) {
    try {
      const admin = await db.models.User.findOne({
        where: { role: 'admin', company_id: companyId },
        attributes: ['id']
      });
      if (admin) adminId = admin.id;
    } catch (e) {}
  }

  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const normalizedGateway = normalizeGatewayValue(gateway);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      (CASE WHEN gateway IS NOT NULL AND LOWER(gateway) != 'all' THEN 64000 ELSE 0 END) +
      (CASE WHEN channel IS NOT NULL AND UPPER(channel) != 'ANY' THEN 32000 ELSE 0 END) +
      (CASE WHEN payment_mode IS NOT NULL AND UPPER(payment_mode) != 'ANY' AND UPPER(payment_mode) != 'ALL' THEN 16000 ELSE 0 END) +
      (CASE WHEN settlement_type IS NOT NULL AND UPPER(settlement_type) != 'ANY' THEN 8000 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL AND UPPER(card_classification) != 'ANY' AND UPPER(card_classification) != 'NULL' THEN 4000 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL AND UPPER(card_brand) != 'ANY' AND UPPER(card_brand) != 'ALL' THEN 2000 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL AND UPPER(card_type) != 'ANY' AND UPPER(card_type) != 'ALL' THEN 1000 ELSE 0 END) +
      CASE scope
        WHEN 'franchise_merchant'        THEN 1200000
        WHEN 'franchise_default'         THEN 1100000
        WHEN 'super_franchise_merchant'  THEN 1000000
        WHEN 'super_franchise_franchise' THEN  900000
        WHEN 'super_franchise_default'   THEN  800000
        WHEN 'admin_merchant'            THEN  700000
        WHEN 'admin_franchise'           THEN  600000
        WHEN 'admin_super_franchise'     THEN  500000
        WHEN 'admin_default'             THEN  400000
        WHEN 'super_admin_admin'         THEN  300000
        WHEN 'super_admin_default'       THEN  200000
        ELSE 0
      END
    ) AS specificity
    FROM pg_charge_rules
    WHERE is_active = true
      AND (
            ($1::integer IS NOT NULL AND user_id = $1::integer)
         OR ($11::integer IS NOT NULL AND user_id = $11::integer AND scope = 'super_admin_admin')
         OR (user_id IS NULL
             AND ($2::integer IS NULL OR franchaise_id = $2::integer OR franchaise_id IS NULL)
             AND (super_franchise_id IS NULL OR ($9::integer IS NOT NULL AND super_franchise_id = $9::integer))
             AND ($10::text IS NULL OR company_id IS NULL OR company_id = $10::text)
         )
      )
      AND ($12::text IS NULL OR LOWER(gateway) = LOWER($12::text) OR gateway IS NULL OR LOWER(gateway) = 'all')
      AND ($3::text IS NULL OR UPPER(payment_mode) = UPPER($3::text) OR payment_mode IS NULL OR UPPER(payment_mode) = 'ANY' OR UPPER(payment_mode) = 'ALL')
      AND ($4::text IS NULL OR UPPER(card_type)    = UPPER($4::text)    OR card_type    IS NULL OR UPPER(card_type)    = 'ANY' OR UPPER(card_type)    = 'ALL')
      AND ($5::text IS NULL OR UPPER(card_brand)   = UPPER($5::text)   OR card_brand   IS NULL OR UPPER(card_brand)   = 'ANY' OR UPPER(card_brand)   = 'ALL')
      AND (($6::text IS NOT NULL AND UPPER(card_classification) = UPPER($6::text)) OR card_classification IS NULL OR UPPER(card_classification) = 'ANY' OR UPPER(card_classification) = 'NULL')
      AND (
        $7::text IS NULL
        OR settlement_type IS NULL
        OR UPPER(settlement_type) = 'ANY'
        OR settlement_type = $7::text
        OR ($7::text IN ('T0', 'today_settlement') AND settlement_type IN ('T0', 'today_settlement'))
        OR ($7::text IN ('T1', 'next_day_settlement') AND settlement_type IN ('T1', 'next_day_settlement'))
      )
      AND $8::numeric >= min_amount
      AND ($8::numeric <= max_amount OR max_amount IS NULL)
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
    superFranchiseId ? parseInt(superFranchiseId, 10) : null,
    companyId ? String(companyId).trim() : null,
    adminId ? parseInt(adminId, 10) : null,
    normalizedGateway
  ];

  let bestRule = null;
  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      replacementBase[0],       // $1 userId
      replacementBase[1],       // $2 franchiseId
      replacementBase[2],       // $3 paymentMode
      replacementBase[3],       // $4 cardType
      candidate || null,        // $5 cardBrand
      replacementBase[4],       // $6 classification
      replacementBase[5],       // $7 settlement
      replacementBase[6],       // $8 amount
      replacementBase[7],       // $9 superFranchiseId
      replacementBase[8],       // $10 companyId
      replacementBase[9],       // $11 adminId
      replacementBase[10]       // $12 gateway
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
 * 2. FRANCHISE LEVEL QUERY
 * Resolve the upline charge rule that a franchise owes to its upline (Super Franchise / Admin / Super Admin).
 *
 * Chronological order:
 *   1. super_franchise_franchise (900,000)
 *   2. super_franchise_default   (800,000)
 *   3. admin_franchise           (600,000)
 *   4. admin_super_franchise     (500,000)
 *   5. admin_default             (400,000)
 *   6. super_admin_admin         (300,000)
 *   7. super_admin_default       (200,000)
 */
async function getAdminChargeRuleForFranchise({
  franchiseId,
  superFranchiseId,
  companyId,
  adminId,
  gateway,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount,
  companyName
}) {
  if (franchiseId && (!superFranchiseId || !companyId || !adminId)) {
    try {
      const dbFranchise = await db.models.User.findByPk(franchiseId, {
        attributes: ['id', 'super_franchise_id', 'company_id', 'admin_id']
      });
      if (dbFranchise) {
        if (!superFranchiseId) superFranchiseId = dbFranchise.super_franchise_id;
        if (!companyId) companyId = dbFranchise.company_id;
        if (!adminId) adminId = dbFranchise.admin_id;
      }
    } catch (e) {}
  }
  if (!adminId && companyId) {
    try {
      const admin = await db.models.User.findOne({
        where: { role: 'admin', company_id: companyId },
        attributes: ['id']
      });
      if (admin) adminId = admin.id;
    } catch (e) {}
  }

  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const normalizedGateway = normalizeGatewayValue(gateway);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      (CASE WHEN gateway IS NOT NULL AND LOWER(gateway) != 'all' THEN 64000 ELSE 0 END) +
      (CASE WHEN channel IS NOT NULL AND UPPER(channel) != 'ANY' THEN 32000 ELSE 0 END) +
      (CASE WHEN payment_mode IS NOT NULL AND UPPER(payment_mode) != 'ANY' AND UPPER(payment_mode) != 'ALL' THEN 16000 ELSE 0 END) +
      (CASE WHEN settlement_type IS NOT NULL AND UPPER(settlement_type) != 'ANY' THEN 8000 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL AND UPPER(card_classification) != 'ANY' AND UPPER(card_classification) != 'NULL' THEN 4000 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL AND UPPER(card_brand) != 'ANY' AND UPPER(card_brand) != 'ALL' THEN 2000 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL AND UPPER(card_type) != 'ANY' AND UPPER(card_type) != 'ALL' THEN 1000 ELSE 0 END) +
      CASE scope
        WHEN 'super_franchise_franchise' THEN 900000
        WHEN 'super_franchise_default'   THEN 800000
        WHEN 'admin_franchise'           THEN 600000
        WHEN 'admin_super_franchise'     THEN 500000
        WHEN 'admin_default'             THEN 400000
        WHEN 'super_admin_admin'         THEN 300000
        WHEN 'super_admin_default'       THEN 200000
        ELSE 0
      END
    ) AS specificity
    FROM pg_charge_rules
    WHERE is_active = true
      AND (
        (user_id IS NULL AND scope = 'super_franchise_franchise' AND ($8::integer IS NOT NULL AND super_franchise_id = $8::integer) AND franchaise_id = $1)
        OR (user_id IS NULL AND scope = 'super_franchise_default' AND ($8::integer IS NOT NULL AND super_franchise_id = $8::integer) AND franchaise_id IS NULL)
        OR (user_id IS NULL AND scope = 'admin_franchise' AND (franchaise_id = $1 OR franchaise_id IS NULL))
        OR (user_id IS NULL AND scope = 'admin_super_franchise' AND ($8::integer IS NOT NULL AND super_franchise_id = $8::integer) AND franchaise_id IS NULL)
        OR (user_id IS NULL AND scope = 'admin_default' AND franchaise_id IS NULL)
        OR ($10::integer IS NOT NULL AND user_id = $10::integer AND scope = 'super_admin_admin')
        OR (user_id IS NULL AND scope = 'super_admin_default')
      )
      AND ($9::text IS NULL OR company_id IS NULL OR company_id = $9::text)
      AND ($11::text IS NULL OR LOWER(gateway) = LOWER($11::text) OR gateway IS NULL OR LOWER(gateway) = 'all')
      AND (UPPER(payment_mode) = $2 OR payment_mode IS NULL OR UPPER(payment_mode) = 'ANY' OR UPPER(payment_mode) = 'ALL')
      AND (UPPER(card_type)    = $3 OR card_type    IS NULL OR UPPER(card_type)    = 'ANY' OR UPPER(card_type)    = 'ALL')
      AND (UPPER(card_brand)   = $4 OR card_brand   IS NULL OR UPPER(card_brand)   = 'ANY' OR UPPER(card_brand)   = 'ALL')
      AND (($5::text IS NOT NULL AND UPPER(card_classification) = UPPER($5::text)) OR card_classification IS NULL OR UPPER(card_classification) = 'ANY' OR UPPER(card_classification) = 'NULL')
      AND (
        $6::text IS NULL
        OR settlement_type IS NULL
        OR UPPER(settlement_type) = 'ANY'
        OR settlement_type = $6::text
        OR ($6::text IN ('T0', 'today_settlement') AND settlement_type IN ('T0', 'today_settlement'))
        OR ($6::text IN ('T1', 'next_day_settlement') AND settlement_type IN ('T1', 'next_day_settlement'))
      )
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
    amount != null ? parseFloat(amount) : 0,
    superFranchiseId || null,
    companyId ? String(companyId).trim() : null,
    adminId ? parseInt(adminId, 10) : null,
    normalizedGateway
  ];

  let bestRule = null;
  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      replacementBase[0],       // $1 franchiseId
      replacementBase[1],       // $2 paymentMode
      replacementBase[2],       // $3 cardType
      candidate || null,        // $4 cardBrand
      replacementBase[3],       // $5 classification
      replacementBase[4],       // $6 settlement
      replacementBase[5],       // $7 amount
      replacementBase[6],       // $8 superFranchiseId
      replacementBase[7],       // $9 companyId
      replacementBase[8],       // $10 adminId
      replacementBase[9]        // $11 gateway
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
 * 3. SUPER FRANCHISE LEVEL QUERY
 * Resolve the upline charge rule that a super franchise owes to Admin / Super Admin.
 *
 * Chronological order:
 *   1. admin_super_franchise (500,000)
 *   2. admin_default         (400,000)
 *   3. super_admin_admin     (300,000)
 *   4. super_admin_default   (200,000)
 */
async function getAdminChargeRuleForSuperFranchise({
  superFranchiseId,
  companyId,
  adminId,
  gateway,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount,
  companyName
}) {
  if (superFranchiseId && (!companyId || !adminId)) {
    try {
      const dbSf = await db.models.User.findByPk(superFranchiseId, {
        attributes: ['id', 'company_id', 'admin_id']
      });
      if (dbSf) {
        if (!companyId) companyId = dbSf.company_id;
        if (!adminId) adminId = dbSf.admin_id;
      }
    } catch (e) {}
  }
  if (!adminId && companyId) {
    try {
      const admin = await db.models.User.findOne({
        where: { role: 'admin', company_id: companyId },
        attributes: ['id']
      });
      if (admin) adminId = admin.id;
    } catch (e) {}
  }

  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const normalizedGateway = normalizeGatewayValue(gateway);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      (CASE WHEN gateway IS NOT NULL AND LOWER(gateway) != 'all' THEN 64000 ELSE 0 END) +
      (CASE WHEN channel IS NOT NULL AND UPPER(channel) != 'ANY' THEN 32000 ELSE 0 END) +
      (CASE WHEN payment_mode IS NOT NULL AND UPPER(payment_mode) != 'ANY' AND UPPER(payment_mode) != 'ALL' THEN 16000 ELSE 0 END) +
      (CASE WHEN settlement_type IS NOT NULL AND UPPER(settlement_type) != 'ANY' THEN 8000 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL AND UPPER(card_classification) != 'ANY' AND UPPER(card_classification) != 'NULL' THEN 4000 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL AND UPPER(card_brand) != 'ANY' AND UPPER(card_brand) != 'ALL' THEN 2000 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL AND UPPER(card_type) != 'ANY' AND UPPER(card_type) != 'ALL' THEN 1000 ELSE 0 END) +
      CASE scope
        WHEN 'admin_super_franchise' THEN 500000
        WHEN 'admin_default'         THEN 400000
        WHEN 'super_admin_admin'     THEN 300000
        WHEN 'super_admin_default'   THEN 200000
        ELSE 0
      END
    ) AS specificity
    FROM pg_charge_rules
    WHERE is_active = true
      AND (
        (user_id IS NULL AND scope = 'admin_super_franchise' AND (super_franchise_id = $1 OR super_franchise_id IS NULL))
        OR (user_id IS NULL AND scope = 'admin_default' AND franchaise_id IS NULL AND super_franchise_id IS NULL)
        OR ($9::integer IS NOT NULL AND user_id = $9::integer AND scope = 'super_admin_admin')
        OR (user_id IS NULL AND scope = 'super_admin_default')
      )
      AND franchaise_id IS NULL
      AND ($8::text IS NULL OR company_id IS NULL OR company_id = $8::text)
      AND ($10::text IS NULL OR LOWER(gateway) = LOWER($10::text) OR gateway IS NULL OR LOWER(gateway) = 'all')
      AND (UPPER(payment_mode) = $2 OR payment_mode IS NULL OR UPPER(payment_mode) = 'ANY' OR UPPER(payment_mode) = 'ALL')
      AND (UPPER(card_type)    = $3 OR card_type    IS NULL OR UPPER(card_type)    = 'ANY' OR UPPER(card_type)    = 'ALL')
      AND (UPPER(card_brand)   = $4 OR card_brand   IS NULL OR UPPER(card_brand)   = 'ANY' OR UPPER(card_brand)   = 'ALL')
      AND (($5::text IS NOT NULL AND UPPER(card_classification) = UPPER($5::text)) OR card_classification IS NULL OR UPPER(card_classification) = 'ANY' OR UPPER(card_classification) = 'NULL')
      AND (
        $6::text IS NULL
        OR settlement_type IS NULL
        OR UPPER(settlement_type) = 'ANY'
        OR settlement_type = $6::text
        OR ($6::text IN ('T0', 'today_settlement') AND settlement_type IN ('T0', 'today_settlement'))
        OR ($6::text IN ('T1', 'next_day_settlement') AND settlement_type IN ('T1', 'next_day_settlement'))
      )
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
    amount != null ? parseFloat(amount) : 0,
    companyId ? String(companyId).trim() : null,
    adminId ? parseInt(adminId, 10) : null,
    normalizedGateway
  ];

  let bestRule = null;
  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      replacementBase[0],       // $1 superFranchiseId
      replacementBase[1],       // $2 paymentMode
      replacementBase[2],       // $3 cardType
      candidate || null,        // $4 cardBrand
      replacementBase[3],       // $5 classification
      replacementBase[4],       // $6 settlement
      replacementBase[5],       // $7 amount
      replacementBase[6],       // $8 companyId
      replacementBase[7],       // $9 adminId
      replacementBase[8]        // $10 gateway
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
 * 4. ADMIN LEVEL QUERY
 * "like for admin we need only admin_default then superAdmin_admin types."
 *
 * Chronological order for Admin effective rules:
 *   1. admin_default       (400,000 - Tenant admin's own default rate)
 *   2. super_admin_admin   (300,000 - Super Admin custom rate for this admin)
 *   3. super_admin_default (200,000 - Global Super Admin baseline)
 */
async function getAdminEffectiveRule({
  adminId,
  companyId,
  gateway,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount,
  companyName
}) {
  if (adminId && !companyId) {
    try {
      const adminUser = await db.models.User.findByPk(adminId, {
        attributes: ['id', 'company_id']
      });
      if (adminUser) companyId = adminUser.company_id;
    } catch (e) {}
  }
  if (!adminId && companyId) {
    try {
      const adminUser = await db.models.User.findOne({
        where: { role: 'admin', company_id: companyId },
        attributes: ['id']
      });
      if (adminUser) adminId = adminUser.id;
    } catch (e) {}
  }

  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const normalizedGateway = normalizeGatewayValue(gateway);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      (CASE WHEN gateway IS NOT NULL AND LOWER(gateway) != 'all' THEN 64000 ELSE 0 END) +
      (CASE WHEN channel IS NOT NULL AND UPPER(channel) != 'ANY' THEN 32000 ELSE 0 END) +
      (CASE WHEN payment_mode IS NOT NULL AND UPPER(payment_mode) != 'ANY' AND UPPER(payment_mode) != 'ALL' THEN 16000 ELSE 0 END) +
      (CASE WHEN settlement_type IS NOT NULL AND UPPER(settlement_type) != 'ANY' THEN 8000 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL AND UPPER(card_classification) != 'ANY' AND UPPER(card_classification) != 'NULL' THEN 4000 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL AND UPPER(card_brand) != 'ANY' AND UPPER(card_brand) != 'ALL' THEN 2000 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL AND UPPER(card_type) != 'ANY' AND UPPER(card_type) != 'ALL' THEN 1000 ELSE 0 END) +
      CASE scope
        WHEN 'admin_default'       THEN 400000
        WHEN 'super_admin_admin'   THEN 300000
        WHEN 'super_admin_default' THEN 200000
        ELSE 0
      END
    ) AS specificity
    FROM pg_charge_rules
    WHERE is_active = true
      AND scope IN ('admin_default', 'super_admin_admin', 'super_admin_default')
      AND (
        (user_id IS NULL AND scope = 'admin_default' AND ($1::text IS NULL OR company_id = $1::text OR company_id IS NULL) AND franchaise_id IS NULL AND super_franchise_id IS NULL)
        OR ($2::integer IS NOT NULL AND user_id = $2::integer AND scope = 'super_admin_admin')
        OR (user_id IS NULL AND scope = 'super_admin_default')
      )
      AND ($9::text IS NULL OR LOWER(gateway) = LOWER($9::text) OR gateway IS NULL OR LOWER(gateway) = 'all')
      AND ($3::text IS NULL OR UPPER(payment_mode) = UPPER($3::text) OR payment_mode IS NULL OR UPPER(payment_mode) = 'ANY' OR UPPER(payment_mode) = 'ALL')
      AND ($4::text IS NULL OR UPPER(card_type)    = UPPER($4::text)    OR card_type    IS NULL OR UPPER(card_type)    = 'ANY' OR UPPER(card_type)    = 'ALL')
      AND ($5::text IS NULL OR UPPER(card_brand)   = UPPER($5::text)   OR card_brand   IS NULL OR UPPER(card_brand)   = 'ANY' OR UPPER(card_brand)   = 'ALL')
      AND (($6::text IS NOT NULL AND UPPER(card_classification) = UPPER($6::text)) OR card_classification IS NULL OR UPPER(card_classification) = 'ANY' OR UPPER(card_classification) = 'NULL')
      AND (
        $7::text IS NULL
        OR settlement_type IS NULL
        OR UPPER(settlement_type) = 'ANY'
        OR settlement_type = $7::text
        OR ($7::text IN ('T0', 'today_settlement') AND settlement_type IN ('T0', 'today_settlement'))
        OR ($7::text IN ('T1', 'next_day_settlement') AND settlement_type IN ('T1', 'next_day_settlement'))
      )
      AND $8::numeric >= min_amount
      AND ($8::numeric <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const replacementBase = [
    companyId ? String(companyId).trim() : null,
    adminId ? parseInt(adminId, 10) : null,
    normalizedPaymentMode,
    normalizedCardType,
    normalizedClassification,
    settlement || null,
    amount != null ? parseFloat(amount) : 0,
    normalizedGateway
  ];

  let bestRule = null;
  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      replacementBase[0],       // $1 companyId
      replacementBase[1],       // $2 adminId
      replacementBase[2],       // $3 paymentMode
      replacementBase[3],       // $4 cardType
      candidate || null,        // $5 cardBrand
      replacementBase[4],       // $6 classification
      replacementBase[5],       // $7 settlement
      replacementBase[6],       // $8 amount
      replacementBase[7]        // $9 gateway
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
 * 5. SUPER ADMIN CHARGE RULE FOR ADMIN
 * Resolve the platform-level charge that an admin owes to Super Admin.
 *
 * Chronological order:
 *   1. super_admin_admin   (300,000 - Admin specific override)
 *   2. super_admin_default (200,000 - Global baseline)
 */
async function getSuperAdminChargeRuleForAdmin({
  adminId,
  gateway,
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
  const normalizedGateway = normalizeGatewayValue(gateway);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      (CASE WHEN gateway IS NOT NULL AND LOWER(gateway) != 'all' THEN 64000 ELSE 0 END) +
      (CASE WHEN channel IS NOT NULL AND UPPER(channel) != 'ANY' THEN 32000 ELSE 0 END) +
      (CASE WHEN payment_mode IS NOT NULL AND UPPER(payment_mode) != 'ANY' AND UPPER(payment_mode) != 'ALL' THEN 16000 ELSE 0 END) +
      (CASE WHEN settlement_type IS NOT NULL AND UPPER(settlement_type) != 'ANY' THEN 8000 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL AND UPPER(card_classification) != 'ANY' AND UPPER(card_classification) != 'NULL' THEN 4000 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL AND UPPER(card_brand) != 'ANY' AND UPPER(card_brand) != 'ALL' THEN 2000 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL AND UPPER(card_type) != 'ANY' AND UPPER(card_type) != 'ALL' THEN 1000 ELSE 0 END) +
      CASE scope
        WHEN 'super_admin_admin'   THEN 300000
        WHEN 'super_admin_default' THEN 200000
        ELSE 0
      END
    ) AS specificity
    FROM pg_charge_rules
    WHERE is_active = true
      AND scope IN ('super_admin_admin', 'super_admin_default')
      AND (
        ($1::integer IS NOT NULL AND user_id = $1::integer AND scope = 'super_admin_admin')
        OR (user_id IS NULL AND scope = 'super_admin_default')
      )
      AND ($8::text IS NULL OR LOWER(gateway) = LOWER($8::text) OR gateway IS NULL OR LOWER(gateway) = 'all')
      AND ($2::text IS NULL OR UPPER(payment_mode) = UPPER($2::text) OR payment_mode IS NULL OR UPPER(payment_mode) = 'ANY' OR UPPER(payment_mode) = 'ALL')
      AND ($3::text IS NULL OR UPPER(card_type)    = UPPER($3::text)    OR card_type    IS NULL OR UPPER(card_type)    = 'ANY' OR UPPER(card_type)    = 'ALL')
      AND ($4::text IS NULL OR UPPER(card_brand)   = UPPER($4::text)   OR card_brand   IS NULL OR UPPER(card_brand)   = 'ANY' OR UPPER(card_brand)   = 'ALL')
      AND (($5::text IS NOT NULL AND UPPER(card_classification) = UPPER($5::text)) OR card_classification IS NULL OR UPPER(card_classification) = 'ANY' OR UPPER(card_classification) = 'NULL')
      AND (
        $6::text IS NULL
        OR settlement_type IS NULL
        OR UPPER(settlement_type) = 'ANY'
        OR settlement_type = $6::text
        OR ($6::text IN ('T0', 'today_settlement') AND settlement_type IN ('T0', 'today_settlement'))
        OR ($6::text IN ('T1', 'next_day_settlement') AND settlement_type IN ('T1', 'next_day_settlement'))
      )
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
    normalizedGateway
  ];

  let bestRule = null;
  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      replacementBase[0],       // $1 adminId
      replacementBase[1],       // $2 paymentMode
      replacementBase[2],       // $3 cardType
      candidate || null,        // $4 cardBrand
      replacementBase[3],       // $5 classification
      replacementBase[4],       // $6 settlement
      replacementBase[5],       // $7 amount
      replacementBase[6]        // $8 gateway
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
 * 6. SUPER ADMIN BASELINE QUERY
 * Global default platform PG charge rule.
 *
 * Scope: super_admin_default (200,000)
 */
async function getSuperAdminDefaultRule({
  gateway,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount,
  companyName
} = {}) {
  const normalizedPaymentMode = normalizeLookupValue(paymentMode);
  const normalizedCardType = normalizeLookupValue(cardType);
  const normalizedClassification = normalizeLookupValue(classification);
  const normalizedGateway = normalizeGatewayValue(gateway);
  const cardBrandCandidates = getCardBrandCandidates(cardBrand);

  const query = `
    SELECT *,
    (
      (CASE WHEN gateway IS NOT NULL AND LOWER(gateway) != 'all' THEN 64000 ELSE 0 END) +
      (CASE WHEN channel IS NOT NULL AND UPPER(channel) != 'ANY' THEN 32000 ELSE 0 END) +
      (CASE WHEN payment_mode IS NOT NULL AND UPPER(payment_mode) != 'ANY' AND UPPER(payment_mode) != 'ALL' THEN 16000 ELSE 0 END) +
      (CASE WHEN settlement_type IS NOT NULL AND UPPER(settlement_type) != 'ANY' THEN 8000 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL AND UPPER(card_classification) != 'ANY' AND UPPER(card_classification) != 'NULL' THEN 4000 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL AND UPPER(card_brand) != 'ANY' AND UPPER(card_brand) != 'ALL' THEN 2000 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL AND UPPER(card_type) != 'ANY' AND UPPER(card_type) != 'ALL' THEN 1000 ELSE 0 END) +
      200000
    ) AS specificity
    FROM pg_charge_rules
    WHERE is_active = true
      AND scope = 'super_admin_default'
      AND user_id IS NULL
      AND franchaise_id IS NULL
      AND super_franchise_id IS NULL
      AND ($7::text IS NULL OR LOWER(gateway) = LOWER($7::text) OR gateway IS NULL OR LOWER(gateway) = 'all')
      AND ($1::text IS NULL OR UPPER(payment_mode) = UPPER($1::text) OR payment_mode IS NULL OR UPPER(payment_mode) = 'ANY' OR UPPER(payment_mode) = 'ALL')
      AND ($2::text IS NULL OR UPPER(card_type)    = UPPER($2::text)    OR card_type    IS NULL OR UPPER(card_type)    = 'ANY' OR UPPER(card_type)    = 'ALL')
      AND ($3::text IS NULL OR UPPER(card_brand)   = UPPER($3::text)   OR card_brand   IS NULL OR UPPER(card_brand)   = 'ANY' OR UPPER(card_brand)   = 'ALL')
      AND (($4::text IS NOT NULL AND UPPER(card_classification) = UPPER($4::text)) OR card_classification IS NULL OR UPPER(card_classification) = 'ANY' OR UPPER(card_classification) = 'NULL')
      AND (
        $5::text IS NULL
        OR settlement_type IS NULL
        OR UPPER(settlement_type) = 'ANY'
        OR settlement_type = $5::text
        OR ($5::text IN ('T0', 'today_settlement') AND settlement_type IN ('T0', 'today_settlement'))
        OR ($5::text IN ('T1', 'next_day_settlement') AND settlement_type IN ('T1', 'next_day_settlement'))
      )
      AND $6::numeric >= min_amount
      AND ($6::numeric <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const replacementBase = [
    normalizedPaymentMode,
    normalizedCardType,
    normalizedClassification,
    settlement || null,
    amount != null ? parseFloat(amount) : 0,
    normalizedGateway
  ];

  let bestRule = null;
  for (const candidate of cardBrandCandidates.length ? cardBrandCandidates : [null]) {
    const replacements = [
      replacementBase[0],       // $1 paymentMode
      replacementBase[1],       // $2 cardType
      candidate || null,        // $3 cardBrand
      replacementBase[2],       // $4 classification
      replacementBase[3],       // $5 settlement
      replacementBase[4],       // $6 amount
      replacementBase[5]        // $7 gateway
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
 * 7. UNIVERSAL RESOLVER WRAPPER
 * Automatically resolves missing hierarchy and delegates to the appropriate chronological query.
 */
async function getChargeRule(opts = {}) {
  let {
    userId,
    user,
    userRole,
    franchiseId,
    superFranchiseId,
    companyId,
    adminId,
    companyName,
    gateway = 'ALL',
    paymentMode,
    cardType,
    cardBrand,
    classification,
    settlement,
    amount
  } = opts;

  // Support user object passed directly
  if (user && typeof user === 'object') {
    if (!userId) userId = user.id;
    if (!userRole) userRole = user.role;
    if (!franchiseId) franchiseId = user.franchaise_id || user.franchise_id;
    if (!superFranchiseId) superFranchiseId = user.super_franchise_id;
    if (!companyId) companyId = user.company_id;
    if (!adminId) adminId = user.admin_id;
  }

  // Auto-resolve missing hierarchy from database
  if (userId && (!userRole || !companyId || (franchiseId === undefined && superFranchiseId === undefined))) {
    try {
      const dbUser = await db.models.User.findByPk(userId, {
        attributes: ['id', 'role', 'franchaise_id', 'super_franchise_id', 'company_id', 'admin_id']
      });
      if (dbUser) {
        if (!userRole) userRole = dbUser.role;
        if (!franchiseId) franchiseId = dbUser.franchaise_id;
        if (!superFranchiseId) superFranchiseId = dbUser.super_franchise_id;
        if (!companyId) companyId = dbUser.company_id;
        if (!adminId) adminId = dbUser.role === 'admin' ? dbUser.id : dbUser.admin_id;
      }
    } catch (e) {}
  }

  const resolvedPaymentMode = paymentMode || opts.paymentMethod || opts.txn_type || 'ALL';
  const resolvedCardType = cardType || (String(resolvedPaymentMode).toUpperCase() === 'UPI' ? 'UNKNOWN' : null);
  const resolvedCardBrand = cardBrand || opts.paymentCardBrand || opts.card_scheme;
  const resolvedClassification = classification || opts.cardClassification || opts.card_classification;
  const resolvedSettlement = settlement || opts.settlementType || opts.settlement_type;
  const resolvedAmount = amount != null ? parseFloat(amount) : (opts.transactionAmount != null ? parseFloat(opts.transactionAmount) : 0);

  const normalizedRole = String(userRole || '').trim().toLowerCase().replace(/[-_]/g, '');

  let rule = null;

  if (normalizedRole === 'superadmin') {
    rule = await getSuperAdminDefaultRule({
      gateway,
      paymentMode: resolvedPaymentMode,
      cardType: resolvedCardType,
      cardBrand: resolvedCardBrand,
      classification: resolvedClassification,
      settlement: resolvedSettlement,
      amount: resolvedAmount,
      companyName
    });
  } else if (normalizedRole === 'admin') {
    rule = await getAdminEffectiveRule({
      adminId: userId || adminId,
      companyId,
      gateway,
      paymentMode: resolvedPaymentMode,
      cardType: resolvedCardType,
      cardBrand: resolvedCardBrand,
      classification: resolvedClassification,
      settlement: resolvedSettlement,
      amount: resolvedAmount,
      companyName
    });
  } else if (normalizedRole === 'superfranchise') {
    rule = await getAdminChargeRuleForSuperFranchise({
      superFranchiseId: userId || superFranchiseId,
      companyId,
      adminId,
      gateway,
      paymentMode: resolvedPaymentMode,
      cardType: resolvedCardType,
      cardBrand: resolvedCardBrand,
      classification: resolvedClassification,
      settlement: resolvedSettlement,
      amount: resolvedAmount,
      companyName
    });
  } else if (normalizedRole === 'franchise' || normalizedRole === 'franchaise') {
    rule = await getAdminChargeRuleForFranchise({
      franchiseId: userId || franchiseId,
      superFranchiseId,
      companyId,
      adminId,
      gateway,
      paymentMode: resolvedPaymentMode,
      cardType: resolvedCardType,
      cardBrand: resolvedCardBrand,
      classification: resolvedClassification,
      settlement: resolvedSettlement,
      amount: resolvedAmount,
      companyName
    });
  } else {
    // Default: Merchant transaction resolution
    rule = await getTransactionChargeRule({
      userId,
      userRole,
      franchiseId,
      superFranchiseId,
      companyId,
      adminId,
      gateway,
      paymentMode: resolvedPaymentMode,
      cardType: resolvedCardType,
      cardBrand: resolvedCardBrand,
      classification: resolvedClassification,
      settlement: resolvedSettlement,
      amount: resolvedAmount,
      companyName
    });
  }

  if (rule) return rule;

  // Safe fallback default PG rate (2.0% MDR, 0 flat fee, no GST)
  const defaultMdr = process.env.PG_DEFAULT_MDR ? parseFloat(process.env.PG_DEFAULT_MDR) : 2.0;
  return {
    id: null,
    scope: 'super_admin_default',
    gateway: gateway || 'ALL',
    payment_mode: resolvedPaymentMode,
    charge_percent: defaultMdr,
    charge_flat: 0,
    gst_required: false,
    gst_percent: 0,
    is_active: true,
    is_fallback: true
  };
}

/**
 * 8. ROLE-SPECIFIC RATE SETTING FETCHERS
 * Convenience methods for request handlers in controllers
 */

async function rateSettingForSuperAdmin(req) {
  try {
    const gateway = req.query?.gateway || req.body?.gateway || 'ALL';
    const paymentMode = req.query?.payment_mode || req.body?.payment_mode || 'ALL';
    const amount = req.query?.amount || req.body?.amount || 0;

    return await getSuperAdminDefaultRule({
      gateway,
      paymentMode,
      amount
    });
  } catch (error) {
    console.error('Error in rateSettingForSuperAdmin:', error);
    throw error;
  }
}

async function rateSettingForAdmin(req) {
  try {
    const adminId = req.user?.id || req.query?.admin_id;
    const companyId = req.user?.company_id || req.query?.company_id;
    const gateway = req.query?.gateway || req.body?.gateway || 'ALL';
    const paymentMode = req.query?.payment_mode || req.body?.payment_mode || 'ALL';
    const amount = req.query?.amount || req.body?.amount || 0;

    // Follows chronological order: admin_default -> super_admin_admin -> super_admin_default
    return await getAdminEffectiveRule({
      adminId,
      companyId,
      gateway,
      paymentMode,
      amount
    });
  } catch (error) {
    console.error('Error in rateSettingForAdmin:', error);
    throw error;
  }
}

async function rateSettingForSuperFranchise(req) {
  try {
    const superFranchiseId = req.user?.id || req.query?.super_franchise_id;
    const companyId = req.user?.company_id;
    const adminId = req.user?.admin_id;
    const gateway = req.query?.gateway || req.body?.gateway || 'ALL';
    const paymentMode = req.query?.payment_mode || req.body?.payment_mode || 'ALL';
    const amount = req.query?.amount || req.body?.amount || 0;

    // Follows chronological order: admin_super_franchise -> admin_default -> super_admin_admin -> super_admin_default
    return await getAdminChargeRuleForSuperFranchise({
      superFranchiseId,
      companyId,
      adminId,
      gateway,
      paymentMode,
      amount
    });
  } catch (error) {
    console.error('Error in rateSettingForSuperFranchise:', error);
    throw error;
  }
}

async function rateSettingForFranchise(req) {
  try {
    const franchiseId = req.user?.id || req.query?.franchaise_id || req.query?.franchise_id;
    const superFranchiseId = req.user?.super_franchise_id;
    const companyId = req.user?.company_id;
    const adminId = req.user?.admin_id;
    const gateway = req.query?.gateway || req.body?.gateway || 'ALL';
    const paymentMode = req.query?.payment_mode || req.body?.payment_mode || 'ALL';
    const amount = req.query?.amount || req.body?.amount || 0;

    // Follows chronological order: super_franchise_franchise -> super_franchise_default -> admin_franchise -> admin_super_franchise -> admin_default -> super_admin_admin -> super_admin_default
    return await getAdminChargeRuleForFranchise({
      franchiseId,
      superFranchiseId,
      companyId,
      adminId,
      gateway,
      paymentMode,
      amount
    });
  } catch (error) {
    console.error('Error in rateSettingForFranchise:', error);
    throw error;
  }
}

async function rateSettingForMerchant(req) {
  try {
    const merchantId = req.user?.id || req.query?.user_id;
    const gateway = req.query?.gateway || req.body?.gateway || 'ALL';
    const paymentMode = req.query?.payment_mode || req.body?.payment_mode || 'ALL';
    const amount = req.query?.amount || req.body?.amount || 0;

    // Full chronological hierarchy from franchise_merchant down to super_admin_default
    return await getTransactionChargeRule({
      userId: merchantId,
      gateway,
      paymentMode,
      amount
    });
  } catch (error) {
    console.error('Error in rateSettingForMerchant:', error);
    throw error;
  }
}

/**
 * Calculate actual fee & GST
 */
function calculateCharge(amount, rule) {
  const numAmount = parseFloat(amount) || 0;
  if (!rule || numAmount <= 0) {
    return {
      amount: numAmount,
      charge: 0,
      gstAmount: 0,
      totalCharge: 0,
      netAmount: numAmount,
      percentCharge: 0,
      flatCharge: 0
    };
  }

  const percent = parseFloat(rule.charge_percent || 0);
  const flat = parseFloat(rule.charge_flat || 0);
  const gstReq = Boolean(rule.gst_required);
  const gstPct = parseFloat(rule.gst_percent || 0);

  const percentCharge = parseFloat(((numAmount * percent) / 100).toFixed(2));
  const baseCharge = parseFloat((percentCharge + flat).toFixed(2));

  let gstAmount = 0;
  if (gstReq && gstPct > 0) {
    gstAmount = parseFloat(((baseCharge * gstPct) / 100).toFixed(2));
  }

  const totalCharge = parseFloat((baseCharge + gstAmount).toFixed(2));
  const netAmount = parseFloat(Math.max(0, numAmount - totalCharge).toFixed(2));

  return {
    amount: numAmount,
    charge: baseCharge,
    percentCharge,
    flatCharge: flat,
    gstAmount,
    totalCharge,
    netAmount,
    ruleApplied: rule.scope || 'fallback'
  };
}

/**
 * Scope Derivation
 */
function deriveScope(callerRole, userId, franchiseId, superFranchiseId, targetRole = null) {
  const normalizedCaller = callerRole === 'franchise' ? 'franchaise' : callerRole;
  const normalizedTarget = targetRole === 'franchise' ? 'franchaise' : targetRole;

  if (normalizedCaller === 'super_admin' || normalizedCaller === 'superadmin') {
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

  if (normalizedCaller === 'super_franchise' || normalizedCaller === 'superfranchise') {
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
  getAdminEffectiveRule,
  getSuperAdminChargeRuleForAdmin,
  getSuperAdminDefaultRule,
  getChargeRule,
  rateSettingForSuperAdmin,
  rateSettingForAdmin,
  rateSettingForSuperFranchise,
  rateSettingForFranchise,
  rateSettingForMerchant,
  calculateCharge,
  deriveScope,
  normalizeLookupValue,
  normalizeCardBrand,
  normalizeGatewayValue,
  getCardBrandCandidates
};


module.exports = {
  VALID_SCOPES,
  getTransactionChargeRule,
  getAdminChargeRuleForFranchise,
  getAdminChargeRuleForSuperFranchise,
  getAdminEffectiveRule,
  getSuperAdminChargeRuleForAdmin,
  getSuperAdminDefaultRule,
  getChargeRule,
  rateSettingForSuperAdmin,
  rateSettingForAdmin,
  rateSettingForSuperFranchise,
  rateSettingForFranchise,
  rateSettingForMerchant,
  calculateCharge,
  deriveScope,
  normalizeLookupValue,
  normalizeCardBrand,
  normalizeGatewayValue,
  getCardBrandCandidates
};
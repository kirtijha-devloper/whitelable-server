const db = require('../config/database');

/**
 * Return the matching rule row for given search parameters and amount, or null if none.
 * The query implements the specificity scoring described in the technical document.
 *
 * @param {Object} opts
 * @param {number|null} opts.userId
 * @param {string|null} opts.paymentMode
 * @param {string|null} opts.cardType
 * @param {string|null} opts.cardBrand
 * @param {string|null} opts.classification
 * @param {string|null} opts.settlement
 * @param {number} opts.amount
 * @returns {Promise<Object|null>}
 */
async function getTransactionChargeRule({
  userId,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount
}) {
  const query = `
    SELECT *,
    (
      (CASE WHEN user_id IS NOT NULL THEN 8 ELSE 0 END) +
      (CASE WHEN card_classification IS NOT NULL THEN 4 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL THEN 2 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL THEN 1 ELSE 0 END)
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND (user_id = $1 OR user_id IS NULL)
      AND (payment_mode = $2 OR payment_mode IS NULL)
      AND (card_type = $3 OR card_type IS NULL)
      AND (card_brand = $4 OR card_brand IS NULL)
      AND (card_classification = $5 OR card_classification IS NULL)
      AND (settlement_type = $6 OR settlement_type IS NULL)
      AND $7 >= min_amount
      AND ($7 <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const replacements = [
    userId || null,
    paymentMode || null,
    cardType || null,
    cardBrand || null,
    classification || null,
    settlement || null,
    amount
  ];

  const [results] = await db.query(query, { bind: replacements, type: db.QueryTypes.SELECT });
  return results && results[0] ? results[0] : null;
}

/**
 * Calculate the actual charge amount given transaction amount and a matching rule.
 *
 * @param {number} amount
 * @param {Object} rule
 * @returns {number}
 */
function calculateCharge(amount, rule) {
  if (!rule) return 0;
  const percentCharge = parseFloat(amount) * (parseFloat(rule.charge_percent) / 100);
  const flatCharge = rule.charge_flat ? parseFloat(rule.charge_flat) : 0;
  return parseFloat((percentCharge + flatCharge).toFixed(2));
}

module.exports = { getTransactionChargeRule, calculateCharge };

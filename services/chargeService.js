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
  franchiseId,
  paymentMode,
  cardType,
  cardBrand,
  classification,
  settlement,
  amount
}) {
  // The query gives highest weight to a rule matching the userId,
  // then franchiseId, then the usual attributes.  A global rule has
  // specificity = 0.  The WHERE clause only pulls in rows that are
  // relevant to the current transaction (user or franchise matches or
  // both null).
  const query = `
    SELECT *,
    (
      (CASE
         WHEN user_id IS NOT NULL AND user_id = $1 THEN 16
         ELSE 0
       END) +
      (CASE
         WHEN franchaise_id IS NOT NULL AND franchaise_id = $2 THEN 8
         ELSE 0
       END) +
      (CASE WHEN card_classification IS NOT NULL THEN 4 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL THEN 2 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL THEN 1 ELSE 0 END)
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND (
            (user_id = $1)
         OR (user_id IS NULL AND (franchaise_id = $2 OR franchaise_id IS NULL))
      )
      AND (payment_mode = $3 OR payment_mode IS NULL)
      AND (card_type = $4 OR card_type IS NULL)
      AND (card_brand = $5 OR card_brand IS NULL)
      AND (card_classification = $6 OR card_classification IS NULL)
      AND (settlement_type = $7 OR settlement_type IS NULL)
      AND $8 >= min_amount
      AND ($8 <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;

  const replacements = [
    userId || null,
    franchiseId || null,
    paymentMode || null,
    cardType || null,
    cardBrand || null,
    classification || null,
    settlement || null,
    amount
  ];

  // When QueryTypes.SELECT is used, `db.query` returns an array of rows.
  // Previously we destructured the first element which meant `results` was a
  // single object; indexing `results[0]` therefore always returned undefined.
  // Simply keep the full array and pick the first row if present.
  const results = await db.query(query, { bind: replacements, type: db.QueryTypes.SELECT });
  return results && results.length ? results[0] : null;
}

/**
 * Calculate the actual charge amount given transaction amount and a matching rule.
 *
 * @param {number} amount
 * @param {Object} rule
 * @returns {number}
 */
function calculateCharge(amount, rule) {
  // returns object { charge, gstAmount }
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

module.exports = { getTransactionChargeRule, calculateCharge };

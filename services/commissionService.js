const { Op } = require('sequelize');
const CommissionDefault = require('../models/CommissionDefault');
const UserCommission = require('../models/UserCommission');

/**
 * Compute the fee from a commission configuration and transaction amount.
 * Business rule: percentage takes precedence over flat when both are present.
 *
 * @param {Object} commission - Commission record with flat_fee and/or percent_fee
 * @param {number} amount - Transaction amount
 * @returns {{ flat_fee: number, percent_fee: number, charge: number } | null}
 */
function computeFee(commission, amount) {
  if (!commission) return null;
  const amt = parseFloat(amount || 0);
  const flat = commission.flat_fee ? parseFloat(commission.flat_fee) : 0;
  const percent = commission.percent_fee ? parseFloat(commission.percent_fee) : 0;

  if (percent > 0) {
    const charge = parseFloat(((percent / 100) * amt).toFixed(2));
    return { flat_fee: 0, percent_fee: percent, charge };
  }

  const charge = parseFloat((flat || 0).toFixed(2));
  return { flat_fee: flat, percent_fee: 0, charge };
}

/**
 * Pick the most specific commission record from an array of candidates.
 * Scoring weights: brand=4, card_type=2, payment_mode=1.
 * Narrower amount slabs are preferred when amount is given.
 * Records that explicitly specify a field that doesn't match are penalised (-1).
 *
 * @param {Array}  records  - Array of CommissionDefault plain objects
 * @param {Object} search   - { paymentMode, paymentCardBrand, paymentCardType }
 * @param {number} [amount] - Transaction amount for slab filtering
 * @returns {Object|null}   - Best-matching record or null
 */
function pickMostSpecific(records, search, amount) {
  if (!records || records.length === 0) return null;

  let candidates = records;

  // Filter by amount slab when provided
  if (amount !== undefined && amount !== null) {
    const amt = parseFloat(amount);
    const matchedByAmount = records.filter((r) => {
      const min =
        r.min_amount !== null && r.min_amount !== undefined
          ? parseFloat(r.min_amount)
          : 0;
      const max =
        r.max_amount !== null && r.max_amount !== undefined
          ? parseFloat(r.max_amount)
          : Infinity;
      return amt >= min && amt <= max;
    });
    if (matchedByAmount.length) candidates = matchedByAmount;
  }

  const scoreFor = (r) => {
    let s = 0;
    if (r.payment_card_brand) {
      if (
        search.paymentCardBrand &&
        r.payment_card_brand.toUpperCase() === search.paymentCardBrand.toUpperCase()
      )
        s += 4;
      else s -= 1;
    }
    if (r.payment_card_type) {
      if (
        search.paymentCardType &&
        r.payment_card_type.toUpperCase() === search.paymentCardType.toUpperCase()
      )
        s += 2;
      else s -= 1;
    }
    if (r.payment_mode) {
      if (
        search.paymentMode &&
        r.payment_mode.toUpperCase() === search.paymentMode.toUpperCase()
      )
        s += 1;
      else s -= 1;
    }
    // Prefer narrower slabs
    if (
      amount !== undefined &&
      amount !== null &&
      r.min_amount != null &&
      r.max_amount != null
    ) {
      const range = Math.max(
        0,
        parseFloat(r.max_amount) - parseFloat(r.min_amount)
      );
      s += Math.max(0, Math.floor((1 / (range + 1)) * 10));
    }
    return s;
  };

  let best = null;
  let bestScore = -Infinity;
  for (const r of candidates) {
    const sc = scoreFor(r);
    if (sc > bestScore) {
      bestScore = sc;
      best = r;
    }
  }
  return best;
}

/**
 * Resolve the applicable commission for a user given payment parameters.
 *
 * Resolution order:
 *   1. User-specific UserCommission (with user-level flat_fee/percent_fee overrides applied)
 *   2. Global CommissionDefault fallback
 *
 * @param {number} userId                - User ID to look up commission for (merchant or franchise)
 * @param {Object} searchParams          - { paymentMode, paymentCardBrand, paymentCardType }
 * @param {number} amount                - Transaction amount (used for slab matching)
 * @returns {Promise<{
 *   source: 'user'|'default',
 *   commission: Object,
 *   fee: { flat_fee: number, percent_fee: number, charge: number }
 * }|null>}
 */
async function resolveCommission(userId, searchParams, amount) {
  const { paymentMode, paymentCardBrand, paymentCardType } = searchParams || {};
  const search = { paymentMode, paymentCardBrand, paymentCardType };

  // ── 1. User-specific commissions ─────────────────────────────────────────
  if (userId) {
    const userLinks = await UserCommission.findAll({
      where: { user_id: userId, is_active: true },
      include: [{ model: CommissionDefault, as: 'defaultCommission' }],
    });

    const userDefaults = userLinks
      .map((l) => {
        const dd = l.defaultCommission;
        if (!dd) return null;
        // Flatten to plain object so we can mutate override fields safely
        const base = dd.get ? dd.get({ plain: true }) : { ...dd };
        // Apply user-specific overrides when set
        if (l.flat_fee !== undefined && l.flat_fee !== null)
          base.flat_fee = l.flat_fee;
        if (l.percent_fee !== undefined && l.percent_fee !== null)
          base.percent_fee = l.percent_fee;
        return base;
      })
      .filter(Boolean);

    const bestUser = pickMostSpecific(userDefaults, search, amount);
    if (bestUser && bestUser.is_active) {
      const fee = computeFee(bestUser, amount);
      return { source: 'user', commission: bestUser, fee };
    }
  }

  // ── 2. Global CommissionDefault fallback ─────────────────────────────────
  const defaultRecords = await CommissionDefault.findAll({
    where: {
      [Op.and]: [
        {
          [Op.or]: [
            { payment_card_brand: paymentCardBrand || null },
            { payment_card_brand: null },
          ],
        },
        {
          [Op.or]: [
            { payment_card_type: paymentCardType || null },
            { payment_card_type: null },
          ],
        },
        {
          [Op.or]: [
            { payment_mode: paymentMode || null },
            { payment_mode: null },
          ],
        },
        { is_active: true },
      ],
    },
  });

  const bestDefault = pickMostSpecific(defaultRecords, search, amount);
  if (bestDefault && bestDefault.is_active) {
    const fee = computeFee(bestDefault, amount);
    return { source: 'default', commission: bestDefault, fee };
  }

  return null; // No commission configuration found
}

module.exports = { resolveCommission, computeFee, pickMostSpecific };

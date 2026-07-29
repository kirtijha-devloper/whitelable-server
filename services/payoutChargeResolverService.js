const { Op } = require('sequelize');

/**
 * 3-Tier Guard Payout Service Charge Resolver.
 *
 * Guard 1: User-specific override from UserPayoutCharges table.
 *   - If table doesn't exist yet or any DB error → silently falls back to Guard 2.
 * Guard 2: Global slab from PayoutCharges table.
 *   - If no matching rule or any DB error → falls back to Guard 3.
 * Guard 3: VIMO_DEFAULT_SERVICE_CHARGE env var (or 0).
 *
 * This function NEVER throws. All errors are caught internally.
 *
 * @param {number|string} userId
 * @param {number|string} amount
 * @returns {Promise<{ charge: number, source: string, slabId: number|null, rate: number, rate_type: string }>}
 */
async function resolvePayoutServiceCharge(userId, amount) {
  const numAmount = parseFloat(amount || 0);

  if (isNaN(numAmount) || numAmount < 0) {
    return { charge: 0, source: 'invalid_amount', slabId: null, rate: 0, rate_type: 'flat' };
  }

  // ── Guard 1: User-specific payout charge override ─────────────────────────
  if (userId) {
    try {
      // Lazy require so that if table hasn't been migrated yet, startup does NOT crash.
      const UserPayoutCharge = require('../models/UserPayoutCharge');
      const userRule = await UserPayoutCharge.findOne({
        where: {
          user_id: userId,
          is_active: true,
          from_amount: { [Op.lte]: numAmount },
          to_amount: { [Op.gte]: numAmount },
        },
        order: [['from_amount', 'DESC']],
      });

      if (userRule) {
        let charge;
        if (userRule.rate_type === 'flat') {
          charge = parseFloat(userRule.rate || 0);
        } else {
          charge = (numAmount * parseFloat(userRule.rate || 0)) / 100.0;
        }
        charge = +charge.toFixed(2);
        return { charge, source: 'user_override', slabId: userRule.id, rate: parseFloat(userRule.rate), rate_type: userRule.rate_type };
      }
    } catch (err) {
      // Table may not exist yet — log but do NOT crash
      console.warn('[PayoutChargeResolver] Guard 1 (UserPayoutCharge) lookup failed, falling back to Guard 2:', err.message);
    }
  }

  // ── Guard 2: Global payout charge slab ────────────────────────────────────
  try {
    const PayoutCharge = require('../models/PayoutCharge');
    const globalRule = await PayoutCharge.findOne({
      where: {
        is_active: true,
        from_amount: { [Op.lte]: numAmount },
        to_amount: { [Op.gte]: numAmount },
      },
      order: [['from_amount', 'DESC']],
    });

    if (globalRule) {
      let charge;
      if (globalRule.rate_type === 'flat') {
        charge = parseFloat(globalRule.rate || 0);
      } else {
        charge = (numAmount * parseFloat(globalRule.rate || 0)) / 100.0;
      }
      charge = +charge.toFixed(2);
      return { charge, source: 'global_slab', slabId: globalRule.id, rate: parseFloat(globalRule.rate), rate_type: globalRule.rate_type };
    }
  } catch (err) {
    console.warn('[PayoutChargeResolver] Guard 2 (PayoutCharge) lookup failed, falling back to Guard 3:', err.message);
  }

  // ── Guard 3: Env / system default ─────────────────────────────────────────
  const fallbackCharge = parseFloat(process.env.VIMO_DEFAULT_SERVICE_CHARGE || 0);
  return { charge: fallbackCharge, source: 'env_fallback', slabId: null, rate: fallbackCharge, rate_type: 'flat' };
}

module.exports = { resolvePayoutServiceCharge };

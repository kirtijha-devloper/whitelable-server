const { Op } = require('sequelize');

/**
 * Hierarchical Payout Service Charge Resolver.
 *
 * Guard 1: User-specific override from UserPayoutCharges table (user_id = merchantId).
 *   - If no user override or error → falls back to Guard 1.5.
 * Guard 1.5: Company-specific slab from UserPayoutCharges table (company_id = merchant.company_id).
 *   - Configured by Company Admin for their white-label company.
 *   - If no company slab or error → falls back to Guard 2.
 * Guard 2: Super Admin Platform Default global slab from PayoutCharges table.
 *   - If no matching rule or error → falls back to Guard 3.
 * Guard 3: Env / system default (DEFAULT_PAYOUT_SERVICE_CHARGE || VIMO_DEFAULT_SERVICE_CHARGE || 0).
 *
 * This function NEVER throws. All errors are caught internally.
 *
 * @param {number|string|Object} userId - User ID or options object { userId, amount, companyId }
 * @param {number|string} [amount]     - Payout principal amount
 * @param {string} [companyId]         - Optional company ID override
 * @returns {Promise<{ charge: number, source: string, slabId: number|null, rate: number, rate_type: string, company_id?: string|null }>}
 */
async function resolvePayoutServiceCharge(userId, amount, companyId = null) {
  let targetUserId = userId;
  let targetAmount = amount;
  let targetCompanyId = companyId;

  if (typeof userId === 'object' && userId !== null) {
    targetUserId = userId.userId || userId.user_id || null;
    targetAmount = userId.amount !== undefined ? userId.amount : amount;
    targetCompanyId = userId.companyId || userId.company_id || companyId || null;
  }

  const numAmount = parseFloat(targetAmount || 0);

  if (isNaN(numAmount) || numAmount < 0) {
    return { charge: 0, source: 'invalid_amount', slabId: null, rate: 0, rate_type: 'flat' };
  }

  // ── Guard 1: User-specific payout charge override ─────────────────────────
  if (targetUserId) {
    try {
      const UserPayoutCharge = require('../models/UserPayoutCharge');
      const userRule = await UserPayoutCharge.findOne({
        where: {
          user_id: targetUserId,
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
        return {
          charge,
          source: 'user_override',
          slabId: userRule.id,
          rate: parseFloat(userRule.rate),
          rate_type: userRule.rate_type,
          company_id: userRule.company_id || null,
        };
      }
    } catch (err) {
      console.warn('[PayoutChargeResolver] Guard 1 (UserPayoutCharge) lookup failed, falling back to Guard 1.5:', err.message);
    }
  }

  // ── Guard 1.5: Company-specific payout charge slab ────────────────────────
  try {
    let effectiveCompanyId = targetCompanyId;
    if (!effectiveCompanyId && targetUserId) {
      const User = require('../models/User');
      const targetUser = await User.findByPk(targetUserId, { attributes: ['id', 'company_id'] });
      effectiveCompanyId = targetUser?.company_id || null;
    }

    if (effectiveCompanyId) {
      const UserPayoutCharge = require('../models/UserPayoutCharge');
      const companyRule = await UserPayoutCharge.findOne({
        where: {
          company_id: effectiveCompanyId,
          is_active: true,
          from_amount: { [Op.lte]: numAmount },
          to_amount: { [Op.gte]: numAmount },
        },
        order: [['from_amount', 'DESC'], ['id', 'DESC']],
      });

      if (companyRule) {
        let charge;
        if (companyRule.rate_type === 'flat') {
          charge = parseFloat(companyRule.rate || 0);
        } else {
          charge = (numAmount * parseFloat(companyRule.rate || 0)) / 100.0;
        }
        charge = +charge.toFixed(2);
        return {
          charge,
          source: 'company_slab',
          slabId: companyRule.id,
          rate: parseFloat(companyRule.rate),
          rate_type: companyRule.rate_type,
          company_id: effectiveCompanyId,
        };
      }
    }
  } catch (compErr) {
    console.warn('[PayoutChargeResolver] Guard 1.5 (Company slab) lookup failed, falling back to Guard 2:', compErr.message);
  }

  // ── Guard 2: Super Admin Global platform payout charge slab ───────────────
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
      return {
        charge,
        source: 'super_admin_global_slab',
        slabId: globalRule.id,
        rate: parseFloat(globalRule.rate),
        rate_type: globalRule.rate_type,
      };
    }
  } catch (err) {
    console.warn('[PayoutChargeResolver] Guard 2 (PayoutCharge) lookup failed, falling back to Guard 3:', err.message);
  }

  // ── Guard 3: Env / system default ─────────────────────────────────────────
  const fallbackCharge = parseFloat(process.env.DEFAULT_PAYOUT_SERVICE_CHARGE || process.env.VIMO_DEFAULT_SERVICE_CHARGE || 0);
  return { charge: fallbackCharge, source: 'env_fallback', slabId: null, rate: fallbackCharge, rate_type: 'flat' };
}

module.exports = { resolvePayoutServiceCharge };

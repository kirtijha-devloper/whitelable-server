const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const UserPayoutCharge = require('../models/UserPayoutCharge');
const User = require('../models/User');
const Company = require('../models/Company');

// ── Helper: check for overlapping slab range for a user ──────────────────────
async function checkSlabOverlap(userId, fromAmount, toAmount, excludeId = null) {
  const where = {
    user_id: userId,
    from_amount: { [Op.lte]: toAmount },
    to_amount: { [Op.gte]: fromAmount },
  };
  if (excludeId) {
    where.id = { [Op.ne]: excludeId };
  }
  return UserPayoutCharge.findOne({ where });
}

// ── Helper: resolve company ID for a given user or request ───────────────────
async function resolveCompanyId(targetUser, req) {
  if (req.body?.company_id) return req.body.company_id;
  if (targetUser?.company_id) return targetUser.company_id;
  if (req.company) return req.company;
  if (req.user?.company_id) return req.user.company_id;

  if (targetUser?.id) {
    try {
      const comp = await Company.findOne({ where: { user_id: targetUser.id } });
      if (comp?.company_id) return comp.company_id;
    } catch (_) {}
  }
  if (req.user?.id) {
    try {
      const comp = await Company.findOne({ where: { user_id: req.user.id } });
      if (comp?.company_id) return comp.company_id;
    } catch (_) {}
  }
  return null;
}

// ── Create a new user payout charge rule ─────────────────────────────────────
const createUserPayoutCharge = asyncHandler(async (req, res) => {
  const { user_id, from_amount, to_amount, rate, rate_type, is_active, description } = req.body;

  if (!user_id || from_amount === undefined || to_amount === undefined || rate === undefined || !rate_type) {
    return res.status(400).json({ success: false, message: 'user_id, from_amount, to_amount, rate, and rate_type are required' });
  }

  const user = await User.findByPk(user_id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (req.user?.role === 'admin') {
    if (['admin', 'super_admin'].includes(user.role) && user.id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Cannot configure payout rates for other admins or super admin' });
    }
    if (req.company && user.company_id && user.company_id !== req.company) {
      return res.status(403).json({ success: false, message: 'Cannot configure rates for users of another company' });
    }
  }

  if (!['percentage', 'flat'].includes(rate_type)) {
    return res.status(400).json({ success: false, message: 'rate_type must be "percentage" or "flat"' });
  }

  const numFrom = parseFloat(from_amount);
  const numTo = parseFloat(to_amount);
  const numRate = parseFloat(rate);

  if (isNaN(numFrom) || isNaN(numTo) || numFrom >= numTo) {
    return res.status(400).json({ success: false, message: 'from_amount must be strictly less than to_amount' });
  }
  if (isNaN(numRate) || numRate < 0) {
    return res.status(400).json({ success: false, message: 'rate must be >= 0' });
  }

  const overlap = await checkSlabOverlap(user_id, numFrom, numTo);
  if (overlap) {
    return res.status(400).json({
      success: false,
      message: `Range (${numFrom}–${numTo}) overlaps with existing slab ID ${overlap.id} (${overlap.from_amount}–${overlap.to_amount}) for this user`,
    });
  }

  const companyId = await resolveCompanyId(user, req);

  if (!companyId) {
    console.log(`UserId --> ${req.user.id} :: Domain or Company is not registered`);
    return res.status(400).json({ message: 'No Domain Name or Company is registered' });
  }

  const rule = await UserPayoutCharge.create({
    user_id,
    from_amount: numFrom,
    to_amount: numTo,
    rate: numRate,
    rate_type,
    is_active: is_active !== undefined ? is_active : true,
    description: description || null,
    company_id: companyId,
  });

  return res.status(201).json({ success: true, data: rule });
});

// ── List all rules (optionally filtered by user_id / is_active) ──────────────
const listAllUserPayoutCharges = asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.user_id) where.user_id = req.query.user_id;
  if (req.query.is_active !== undefined) where.is_active = req.query.is_active === 'true';

  if (req.user?.role === 'admin' && req.company) {
    where.company_id = req.company;
  }

  // Super-admin can see all admin charges
  if (req.user?.role === 'super_admin' && !req.query.user_id) {
    const adminUsers = await User.findAll({
      where: { role: 'admin' },
      attributes: ['id'],
    });
    where.user_id = { [Op.in]: adminUsers.map((a) => a.id) };
  }

  const rules = await UserPayoutCharge.findAll({
    where,
    order: [['user_id', 'ASC'], ['from_amount', 'ASC']],
  });

  return res.status(200).json({ success: true, data: rules });
});

// ── Get all rules for a specific user (returns franchise_id, super_franchise_id, user_id payouts) ────────
const getUserPayoutChargesByUser = asyncHandler(async (req, res) => {
  const paramUserId = req.params.userId;
  const isSuperAdminCaller = req.user?.role === 'super_admin';

  // If super-admin is calling and no specific userId is passed (or 'me' is passed):
  // Super-admin can see all the admin charges!
  if (isSuperAdminCaller && (!paramUserId || paramUserId === 'me')) {
    const adminUsers = await User.findAll({
      where: { role: 'admin' },
      attributes: ['id', 'name', 'username', 'email', 'mobile_number', 'company_id'],
    });
    const adminUserIds = adminUsers.map((a) => a.id);
    const adminMap = new Map(adminUsers.map((a) => [Number(a.id), a]));

    const rawRules = await UserPayoutCharge.findAll({
      where: {
        user_id: { [Op.in]: adminUserIds },
        ...(req.query.is_active !== undefined ? { is_active: req.query.is_active === 'true' } : {}),
      },
      order: [['user_id', 'ASC'], ['from_amount', 'ASC']],
    });

    const annotatedRules = rawRules.map((r) => {
      const item = r.toJSON ? r.toJSON() : { ...r };
      const u = adminMap.get(Number(item.user_id));
      return {
        ...item,
        payout_type: 'user_id',
        user: u
          ? {
              id: u.id,
              name: u.name,
              username: u.username,
              email: u.email,
              mobile_number: u.mobile_number,
              company_id: u.company_id,
              role: 'admin',
            }
          : null,
      };
    });

    return res.status(200).json({
      success: true,
      data: annotatedRules,
      user_id: req.user.id,
      payouts: {
        user_id: annotatedRules,
        franchise_id: [],
        super_franchise_id: [],
        company_id: [],
      },
      user_payouts: annotatedRules,
      franchise_payouts: [],
      super_franchise_payouts: [],
      company_payouts: [],
    });
  }

  const userId = !paramUserId || paramUserId === 'me' ? req.user?.id : paramUserId;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'user_id is required' });
  }

  const targetUser = await User.findByPk(userId);
  if (!targetUser) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const companyId = await resolveCompanyId(targetUser, req);

  const targetId = Number(targetUser.id);
  const userRole = String(targetUser.role || '').toLowerCase();
  const franchiseId = ['franchise', 'franchaise'].includes(userRole)
    ? targetId
    : targetUser.franchaise_id
    ? Number(targetUser.franchaise_id)
    : null;
  const superFranchiseId = userRole === 'super_franchise'
    ? targetId
    : targetUser.super_franchise_id
    ? Number(targetUser.super_franchise_id)
    : null;
  const adminId = targetUser.admin_id ? Number(targetUser.admin_id) : null;

  const candidateUserIds = [targetId];
  if (franchiseId && !candidateUserIds.includes(franchiseId)) candidateUserIds.push(franchiseId);
  if (superFranchiseId && !candidateUserIds.includes(superFranchiseId)) candidateUserIds.push(superFranchiseId);
  if (adminId && !candidateUserIds.includes(adminId)) candidateUserIds.push(adminId);

  const whereOrConditions = [
    { user_id: { [Op.in]: candidateUserIds } }
  ];
  if (companyId) {
    whereOrConditions.push({ company_id: companyId });
  }

  const rawRules = await UserPayoutCharge.findAll({
    where: {
      [Op.or]: whereOrConditions,
      is_active: true,
    },
    order: [['from_amount', 'ASC']],
  });

  const annotatedRules = rawRules.map((r) => {
    const item = r.toJSON ? r.toJSON() : { ...r };
    const rUid = Number(item.user_id);
    let pType = 'user_id';
    if (rUid === targetId) {
      pType = 'user_id';
    } else if (franchiseId && rUid === franchiseId) {
      pType = 'franchise_id';
    } else if (superFranchiseId && rUid === superFranchiseId) {
      pType = 'super_franchise_id';
    } else if (adminId && rUid === adminId) {
      pType = 'admin_id';
    } else {
      pType = 'company_id';
    }

    return {
      ...item,
      payout_type: pType,
      franchise_id: franchiseId,
      super_franchise_id: superFranchiseId,
    };
  });

  const userPayouts = annotatedRules.filter((r) => r.payout_type === 'user_id');
  const franchisePayouts = annotatedRules.filter((r) => r.payout_type === 'franchise_id');
  const superFranchisePayouts = annotatedRules.filter((r) => r.payout_type === 'super_franchise_id');
  const companyPayouts = annotatedRules.filter((r) => r.payout_type === 'company_id' || r.payout_type === 'admin_id');

  return res.status(200).json({
    success: true,
    data: annotatedRules,
    user_id: targetId,
    franchise_id: franchiseId,
    super_franchise_id: superFranchiseId,
    company_id: companyId,
    payouts: {
      user_id: userPayouts,
      franchise_id: franchisePayouts,
      super_franchise_id: superFranchisePayouts,
      company_id: companyPayouts,
    },
    user_payouts: userPayouts,
    franchise_payouts: franchisePayouts,
    super_franchise_payouts: superFranchisePayouts,
    company_payouts: companyPayouts,
  });
});

// ── Get all rules for a company ──────────────────────────────────────────────
const getCompanyPayoutCharges = asyncHandler(async (req, res) => {
  let companyId = req.params.companyId || req.company || req.user?.company_id;
  if (!companyId) {
    try {
      const comp = await Company.findOne({ where: { user_id: req.user.id } });
      if (comp) companyId = comp.company_id;
    } catch (_) {}
  }
  if (!companyId) {
    return res.status(400).json({ success: false, message: 'company_id could not be resolved' });
  }

  const rules = await UserPayoutCharge.findAll({
    where: { company_id: companyId },
    order: [['from_amount', 'ASC']],
  });

  return res.status(200).json({
    success: true,
    data: rules,
    company_id: companyId,
  });
});

// ── Get single rule by ID ─────────────────────────────────────────────────────
const getUserPayoutChargeById = asyncHandler(async (req, res) => {
  const rule = await UserPayoutCharge.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'User payout charge rule not found' });
  }
  return res.status(200).json({ success: true, data: rule });
});

// ── Update a rule ─────────────────────────────────────────────────────────────
const updateUserPayoutCharge = asyncHandler(async (req, res) => {
  const rule = await UserPayoutCharge.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'User payout charge rule not found' });
  }

  if (req.user?.role === 'admin') {
    if (req.company && rule.company_id && rule.company_id !== req.company) {
      return res.status(403).json({ success: false, message: 'Cannot modify rules of another company' });
    }
  }

  const companyId = rule.company_id || req.company;

  const { from_amount, to_amount, rate, rate_type, is_active, description } = req.body;

  if (rate_type !== undefined && !['percentage', 'flat'].includes(rate_type)) {
    return res.status(400).json({ success: false, message: 'rate_type must be "percentage" or "flat"' });
  }

  const newFrom = from_amount !== undefined ? parseFloat(from_amount) : parseFloat(rule.from_amount);
  const newTo = to_amount !== undefined ? parseFloat(to_amount) : parseFloat(rule.to_amount);

  if (newFrom >= newTo) {
    return res.status(400).json({ success: false, message: 'from_amount must be strictly less than to_amount' });
  }

  const overlap = await checkSlabOverlap(rule.user_id, newFrom, newTo, rule.id);
  if (overlap) {
    return res.status(400).json({
      success: false,
      message: `Range (${newFrom}–${newTo}) overlaps with existing slab ID ${overlap.id} (${overlap.from_amount}–${overlap.to_amount}) for this user`,
    });
  }

  if (from_amount !== undefined) rule.from_amount = newFrom;
  if (to_amount !== undefined) rule.to_amount = newTo;
  if (rate !== undefined) rule.rate = parseFloat(rate);
  if (rate_type !== undefined) rule.rate_type = rate_type;
  if (is_active !== undefined) rule.is_active = is_active;
  if (description !== undefined) rule.description = description;

  if (companyId) rule.company_id = companyId;
  await rule.save();
  return res.status(200).json({ success: true, data: rule });
});

// ── Delete a rule ─────────────────────────────────────────────────────────────
const deleteUserPayoutCharge = asyncHandler(async (req, res) => {
  const rule = await UserPayoutCharge.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'User payout charge rule not found' });
  }

  if (req.user?.role === 'admin') {
    if (req.company && rule.company_id && rule.company_id !== req.company) {
      return res.status(403).json({ success: false, message: 'Cannot delete rules of another company' });
    }
  }

  await rule.destroy();
  return res.status(200).json({ success: true, message: 'User payout charge rule deleted' });
});

module.exports = {
  createUserPayoutCharge,
  listAllUserPayoutCharges,
  getUserPayoutChargesByUser,
  getCompanyPayoutCharges,
  getUserPayoutChargeById,
  updateUserPayoutCharge,
  deleteUserPayoutCharge,
};

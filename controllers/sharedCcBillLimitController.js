const asyncHandler = require('express-async-handler');
const sharedCcBillLimitService = require('../services/sharedCcBillLimitService');
const User = require('../models/User');
const Company = require('../models/Company');
const { normalizeRole } = require('../utils/permissions');

/**
 * GET /api/shared-cc-bill-limit
 * Read configured Admin daily limit, consumed amount, reserved amount, and remaining capacity.
 */
const getSharedCcBillLimit = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const role = normalizeRole(user.role);
  let targetAdminId = null;

  if (role === 'super_admin') {
    // Super admin can inspect any admin via query param
    const queryAdminId = req.query.admin_id ? Number(req.query.admin_id) : null;
    const queryCompanyId = req.query.company_id ? String(req.query.company_id).trim() : null;

    if (queryAdminId) {
      targetAdminId = queryAdminId;
    } else if (queryCompanyId) {
      const company = await Company.findOne({ where: { company_id: queryCompanyId } });
      if (company?.user_id) {
        targetAdminId = company.user_id;
      }
    }

    if (!targetAdminId) {
      // If super admin didn't specify an admin, find the first admin as a convenience
      const firstAdmin = await User.findOne({ where: { role: 'admin', status: 'active' } });
      if (firstAdmin) {
        targetAdminId = firstAdmin.id;
      } else {
        return res.status(404).json({ success: false, message: 'No Admin user found.' });
      }
    }
  } else {
    // Non-super-admins cannot query another Admin's data. Always resolve from server-side hierarchy.
    try {
      const { adminUser } = await sharedCcBillLimitService.resolveOwningAdmin(user);
      targetAdminId = adminUser.id;
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  try {
    const businessDate = req.query.business_date ? String(req.query.business_date).trim() : null;
    const limitStatus = await sharedCcBillLimitService.getAdminLimitStatus({
      adminId: targetAdminId,
      businessDate,
    });

    return res.status(200).json({
      success: true,
      message: 'Shared CC bill limit retrieved successfully.',
      data: limitStatus,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to retrieve shared CC bill limit.',
    });
  }
});

/**
 * PUT /api/shared-cc-bill-limit
 * Super Admin updates the daily CC bill limit for an Admin.
 * Admin and other child roles cannot modify this limit.
 */
const updateSharedCcBillLimit = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const role = normalizeRole(user.role);
  if (role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only Super Admin is authorized to configure Admin CC bill limits.',
    });
  }

  const { admin_id, company_id, daily_limit } = req.body;

  if (daily_limit === undefined || daily_limit === null) {
    return res.status(400).json({
      success: false,
      message: "Missing required field 'daily_limit'.",
    });
  }

  const parsedLimit = Number(daily_limit);
  if (Number.isNaN(parsedLimit) || parsedLimit < 0) {
    return res.status(400).json({
      success: false,
      message: "'daily_limit' must be a valid non-negative number.",
    });
  }

  let targetAdminId = admin_id ? Number(admin_id) : null;
  if (!targetAdminId && company_id) {
    const company = await Company.findOne({ where: { company_id: String(company_id).trim() } });
    if (company?.user_id) {
      targetAdminId = company.user_id;
    }
  }

  if (!targetAdminId) {
    return res.status(400).json({
      success: false,
      message: "Please provide 'admin_id' or 'company_id' to specify which Admin to update.",
    });
  }

  try {
    const updatedStatus = await sharedCcBillLimitService.updateAdminDailyLimit({
      adminId: targetAdminId,
      dailyLimit: parsedLimit,
      updatedByUserId: user.id,
    });

    return res.status(200).json({
      success: true,
      message: 'Shared CC bill daily limit updated successfully.',
      data: updatedStatus,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to update shared CC bill limit.',
    });
  }
});

module.exports = {
  getSharedCcBillLimit,
  updateSharedCcBillLimit,
};


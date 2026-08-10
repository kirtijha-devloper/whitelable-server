const asyncHandler = require('express-async-handler');
const db = require('../config/database');
const User = require('../models/User');
const {
  SERVICE_SETTING_KEY_LIST,
  isUserServiceTargetRole,
  getServiceSettingsMap,
  upsertServiceSettings,
  upsertUserServiceSettings,
  getServiceToggleAuditLogs,
} = require('../services/serviceSettingsService');
const { normalizeRole } = require('../utils/permissions');

const SERVICE_SETTING_KEY_SET = new Set(SERVICE_SETTING_KEY_LIST);

function getValidatedServiceSettingsPayload(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body)
    ? body
    : {};

  const entries = Object.entries(payload);
  const unknownKeys = entries
    .map(([key]) => key)
    .filter((key) => !SERVICE_SETTING_KEY_SET.has(key));

  if (unknownKeys.length > 0) {
    return {
      error: {
        status: 400,
        body: {
          success: false,
          message: `Unknown service setting key(s): ${unknownKeys.join(', ')}`,
        },
      },
    };
  }

  const invalidTypeKeys = entries
    .filter(([, value]) => typeof value !== 'boolean')
    .map(([key]) => key);

  if (invalidTypeKeys.length > 0) {
    return {
      error: {
        status: 400,
        body: {
          success: false,
          message: `Service setting values must be boolean for: ${invalidTypeKeys.join(', ')}`,
        },
      },
    };
  }

  if (entries.length === 0) {
    return {
      error: {
        status: 400,
        body: {
          success: false,
          message: 'At least one valid service setting is required.',
        },
      },
    };
  }

  return { payload };
}

function extractRequestContext(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip_address = forwarded ? String(forwarded).split(',')[0].trim() : (req.ip || req.connection?.remoteAddress || null);
  const user_agent = req.headers['user-agent'] ? String(req.headers['user-agent']).substring(0, 500) : null;
  return { ip_address, user_agent };
}

const getServiceSettings = asyncHandler(async (_req, res) => {
  const data = await getServiceSettingsMap();

  return res.status(200).json({
    success: true,
    data,
  });
});

const updateServiceSettings = asyncHandler(async (req, res) => {
  const { payload, error } = getValidatedServiceSettingsPayload(req.body);

  if (error) {
    return res.status(error.status).json(error.body);
  }

  const context = extractRequestContext(req);
  const data = await db.transaction(async (transaction) => {
    return await upsertServiceSettings(payload, req.user?.id || null, {
      transaction,
      ...context,
    });
  });

  return res.status(200).json({
    success: true,
    message: 'Service settings updated successfully.',
    data,
  });
});

const updateUserServiceSettings = asyncHandler(async (req, res) => {
  const requesterRole = normalizeRole(req.user?.role);

  if (requesterRole !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Only admin can manage user service settings.',
    });
  }

  const { payload, error } = getValidatedServiceSettingsPayload(req.body);

  if (error) {
    return res.status(error.status).json(error.body);
  }

  const targetUser = await User.findByPk(req.params.id);

  if (!targetUser) {
    return res.status(404).json({
      success: false,
      message: 'User not found.',
    });
  }

  if (!isUserServiceTargetRole(targetUser.role)) {
    return res.status(400).json({
      success: false,
      message: 'Per-user service settings are supported only for merchant and franchise users.',
    });
  }

  const context = extractRequestContext(req);
  const data = await db.transaction(async (transaction) => {
    const {
      user,
      userServiceSettings,
      serviceFlags,
    } = await upsertUserServiceSettings(
      targetUser,
      payload,
      req.user?.id || null,
      {
        transaction,
        ...context,
      }
    );

    return {
      user_id: user.id,
      user_service_settings: userServiceSettings,
      service_flags: serviceFlags,
    };
  });

  return res.status(200).json({
    success: true,
    data,
  });
});

const getServiceToggleAuditLogsController = asyncHandler(async (req, res) => {
  const requesterRole = normalizeRole(req.user?.role);

  if (requesterRole !== 'admin' && requesterRole !== 'employee') {
    return res.status(403).json({
      success: false,
      message: 'Only admin or employee can view service toggle audit logs.',
    });
  }

  const filters = {
    userId: req.query.user_id || req.query.userId,
    affectedUserId: req.query.affected_user_id || req.query.affectedUserId,
    serviceKey: req.query.service_key || req.query.serviceKey,
    page: req.query.page,
    limit: req.query.limit,
  };

  const result = await getServiceToggleAuditLogs(filters);

  return res.status(200).json({
    success: true,
    ...result,
  });
});

module.exports = {
  getServiceSettings,
  updateServiceSettings,
  updateUserServiceSettings,
  getServiceToggleAuditLogsController,
};

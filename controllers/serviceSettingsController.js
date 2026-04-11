const asyncHandler = require('express-async-handler');
const db = require('../config/database');
const User = require('../models/User');
const {
  SERVICE_SETTING_KEY_LIST,
  isUserServiceTargetRole,
  getServiceSettingsMap,
  upsertServiceSettings,
  upsertUserServiceSettings,
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

  const data = await upsertServiceSettings(payload, req.user?.id || null);

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

  const data = await db.transaction(async (transaction) => {
    const {
      user,
      userServiceSettings,
      serviceFlags,
    } = await upsertUserServiceSettings(
      targetUser,
      payload,
      req.user?.id || null,
      { transaction }
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

module.exports = {
  getServiceSettings,
  updateServiceSettings,
  updateUserServiceSettings,
};

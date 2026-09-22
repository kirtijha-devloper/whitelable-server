const asyncHandler = require('express-async-handler');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const LoginPopup = require('../models/LoginPopup');
const { normalizeRole } = require('../utils/permissions');
const { LOGIN_POPUP_UPLOAD_DIR } = require('../middleware/loginPopupUpload');

const ALLOWED_TARGET_ROLES = new Set(['admin', 'employee', 'merchant', 'franchaise']);
const SAFE_UPLOAD_ROOT = path.resolve(LOGIN_POPUP_UPLOAD_DIR);

function getRequestBaseUrl(req) {
  let protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.get('host');

  if (!host) {
    return '';
  }

  if (req.headers['x-forwarded-proto'] === 'https' || host.includes('abheepay.com')) {
    protocol = 'https';
  }

  return `${protocol}://${host}`;
}

function buildImageUrl(req, imagePath) {
  if (!imagePath) {
    return null;
  }

  if (/^https?:\/\//i.test(imagePath)) {
    return imagePath;
  }

  const cleanPath = String(imagePath).replace(/\\/g, '/').replace(/^\/+/, '');
  let relativePath = cleanPath;
  if (!cleanPath.startsWith('api/')) {
    relativePath = cleanPath.startsWith('uploads/') ? `api/${cleanPath}` : `api/uploads/${cleanPath}`;
  }
  relativePath = `/${relativePath}`;

  const baseUrl = getRequestBaseUrl(req);

  return baseUrl ? `${baseUrl}${relativePath}` : relativePath;
}

function serializeLoginPopup(req, popupLike) {
  const popup = popupLike?.toJSON ? popupLike.toJSON() : { ...popupLike };

  return {
    id: popup.id,
    title: popup.title || null,
    image_url: buildImageUrl(req, popup.image_path),
    display_order: Number(popup.display_order || 0),
    is_active: popup.is_active !== false,
    starts_at: popup.starts_at || null,
    ends_at: popup.ends_at || null,
    target_roles: Array.isArray(popup.target_roles) && popup.target_roles.length > 0
      ? popup.target_roles
      : null,
    created_at: popup.created_at || popup.createdAt || null,
    updated_at: popup.updated_at || popup.updatedAt || null,
  };
}

function parseOptionalBoolean(rawValue, fieldName, defaultValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }

  if (typeof rawValue === 'boolean') {
    return rawValue;
  }

  const normalizedValue = String(rawValue).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalizedValue)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalizedValue)) {
    return false;
  }

  throw new Error(`${fieldName} must be a boolean value.`);
}

function parseOptionalInteger(rawValue, fieldName, defaultValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be a valid integer.`);
  }

  return parsed;
}

function parseOptionalDatetime(rawValue, fieldName) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return null;
  }

  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`${fieldName} must be a valid datetime.`);
  }

  return parsedDate;
}

function parseTargetRoles(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return null;
  }

  let parsedRoles = rawValue;

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith('[')) {
      try {
        parsedRoles = JSON.parse(trimmed);
      } catch (_error) {
        throw new Error('target_roles must be a valid JSON array or comma-separated string.');
      }
    } else if (trimmed.includes(',')) {
      parsedRoles = trimmed.split(',').map((role) => role.trim());
    } else {
      parsedRoles = [trimmed];
    }
  }

  if (!Array.isArray(parsedRoles)) {
    parsedRoles = [parsedRoles];
  }

  const normalizedRoles = [...new Set(
    parsedRoles
      .map((role) => normalizeRole(String(role || '').trim()))
      .filter(Boolean)
  )];

  if (normalizedRoles.length === 0) {
    return null;
  }

  const invalidRoles = normalizedRoles.filter((role) => !ALLOWED_TARGET_ROLES.has(role));
  if (invalidRoles.length > 0) {
    throw new Error(`target_roles contains invalid role(s): ${invalidRoles.join(', ')}`);
  }

  return normalizedRoles;
}

function validateDateRange(startsAt, endsAt) {
  if (startsAt && endsAt && startsAt > endsAt) {
    throw new Error('starts_at must be less than or equal to ends_at.');
  }
}

function cleanupUploadedFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(SAFE_UPLOAD_ROOT)) {
      return;
    }
    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
    }
  } catch (_error) {
    // Avoid surfacing cleanup failures to the API caller.
  }
}

function isRoleAllowedForPopup(popupLike, userRole) {
  const popup = popupLike?.toJSON ? popupLike.toJSON() : { ...popupLike };
  const targetRoles = Array.isArray(popup.target_roles) ? popup.target_roles : null;

  if (!targetRoles || targetRoles.length === 0) {
    return true;
  }

  return targetRoles.includes(normalizeRole(userRole));
}

function hasOwnField(body, fieldName) {
  return Boolean(body && Object.prototype.hasOwnProperty.call(body, fieldName));
}

function buildPopupCreatePayload(body, file, options = {}) {
  const {
    requireImage = false,
    existingImagePath = null,
    existingPopup = null,
  } = options;

  const imagePath = file?.path ? String(file.path).replace(/\\/g, '/') : existingImagePath;
  if (requireImage && !imagePath) {
    throw new Error('image file is required.');
  }

  const payload = {
    title: hasOwnField(body, 'title')
      ? (body.title === '' ? null : String(body.title))
      : (existingPopup?.title ?? null),
    image_path: imagePath,
    display_order: hasOwnField(body, 'display_order')
      ? parseOptionalInteger(body.display_order, 'display_order', 0)
      : (existingPopup?.display_order ?? 0),
    is_active: hasOwnField(body, 'is_active')
      ? parseOptionalBoolean(body.is_active, 'is_active', true)
      : (existingPopup?.is_active !== false),
    starts_at: hasOwnField(body, 'starts_at')
      ? parseOptionalDatetime(body.starts_at, 'starts_at')
      : (existingPopup?.starts_at ?? null),
    ends_at: hasOwnField(body, 'ends_at')
      ? parseOptionalDatetime(body.ends_at, 'ends_at')
      : (existingPopup?.ends_at ?? null),
    target_roles: hasOwnField(body, 'target_roles')
      ? parseTargetRoles(body.target_roles)
      : (
        Array.isArray(existingPopup?.target_roles) && existingPopup.target_roles.length > 0
          ? existingPopup.target_roles
          : null
      ),
  };

  validateDateRange(payload.starts_at, payload.ends_at);

  return payload;
}

function requireAdmin(req, res) {
  if (normalizeRole(req.user?.role) !== 'admin') {
    res.status(403);
    throw new Error('Only admin can manage login popups.');
  }
}

const createLoginPopup = asyncHandler(async (req, res) => {
  requireAdmin(req, res);

  try {
    const payload = buildPopupCreatePayload(req.body || {}, req.file, {
      requireImage: true,
    });

    const popup = await LoginPopup.create(payload);

    return res.status(201).json({
      success: true,
      data: serializeLoginPopup(req, popup),
    });
  } catch (error) {
    cleanupUploadedFile(req.file?.path);
    res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 400);
    throw error;
  }
});

const listLoginPopupsForAdmin = asyncHandler(async (req, res) => {
  requireAdmin(req, res);

  const popups = await LoginPopup.findAll({
    order: [
      ['display_order', 'ASC'],
      ['created_at', 'DESC'],
    ],
  });

  return res.status(200).json({
    success: true,
    data: popups.map((popup) => serializeLoginPopup(req, popup)),
  });
});

const updateLoginPopup = asyncHandler(async (req, res) => {
  requireAdmin(req, res);

  const popup = await LoginPopup.findByPk(req.params.id);
  if (!popup) {
    cleanupUploadedFile(req.file?.path);
    return res.status(404).json({
      success: false,
      message: 'Login popup not found.',
    });
  }

  const existingPopup = popup.toJSON ? popup.toJSON() : { ...popup };
  const previousImagePath = existingPopup.image_path;

  try {
    const payload = buildPopupCreatePayload(req.body || {}, req.file, {
      requireImage: false,
      existingImagePath: previousImagePath,
      existingPopup,
    });

    await popup.update(payload);

    if (req.file?.path && previousImagePath && previousImagePath !== payload.image_path) {
      cleanupUploadedFile(previousImagePath);
    }

    return res.status(200).json({
      success: true,
      data: serializeLoginPopup(req, popup),
    });
  } catch (error) {
    cleanupUploadedFile(req.file?.path);
    res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 400);
    throw error;
  }
});

const deleteLoginPopup = asyncHandler(async (req, res) => {
  requireAdmin(req, res);

  const popup = await LoginPopup.findByPk(req.params.id);
  if (!popup) {
    return res.status(404).json({
      success: false,
      message: 'Login popup not found.',
    });
  }

  const popupData = popup.toJSON ? popup.toJSON() : { ...popup };
  await popup.destroy();
  cleanupUploadedFile(popupData.image_path);

  return res.status(200).json({
    success: true,
    message: 'Login popup deleted successfully.',
  });
});

const getActiveLoginPopups = asyncHandler(async (req, res) => {
  const now = new Date();
  const normalizedUserRole = normalizeRole(req.user?.role || 'merchant');

  const popups = await LoginPopup.findAll({
    where: {
      is_active: true,
      [Op.and]: [
        {
          [Op.or]: [
            { starts_at: null },
            { starts_at: { [Op.lte]: now } },
          ],
        },
        {
          [Op.or]: [
            { ends_at: null },
            { ends_at: { [Op.gte]: now } },
          ],
        },
      ],
    },
    order: [
      ['display_order', 'ASC'],
      ['created_at', 'ASC'],
    ],
  });

  const filteredPopups = popups.filter((popup) => isRoleAllowedForPopup(popup, normalizedUserRole));

  return res.status(200).json({
    success: true,
    data: filteredPopups.map((popup) => serializeLoginPopup(req, popup)),
  });
});

module.exports = {
  createLoginPopup,
  listLoginPopupsForAdmin,
  updateLoginPopup,
  deleteLoginPopup,
  getActiveLoginPopups,
};

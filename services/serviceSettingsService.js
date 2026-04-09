const { Op } = require('sequelize');
const ServiceSetting = require('../models/ServiceSetting');
const UserServiceSetting = require('../models/UserServiceSetting');
const User = require('../models/User');
const { normalizeRole } = require('../utils/permissions');

const SERVICE_SETTING_KEYS = Object.freeze({
  VIMO_PAYOUT: 'vimo_payout',
  BRANCHX_PAYOUT: 'branchx_payout',
  CC_BILL_PAY: 'cc_bill_pay',
  BA_CC_BILL_PAY: 'ba_cc_bill_pay',
});

const SERVICE_SETTING_KEY_LIST = Object.freeze(Object.values(SERVICE_SETTING_KEYS));
const SERVICE_SETTING_KEY_SET = new Set(SERVICE_SETTING_KEY_LIST);

const USER_SERVICE_TARGET_ROLES = Object.freeze(['merchant', 'franchaise']);
const USER_SERVICE_TARGET_ROLE_SET = new Set(USER_SERVICE_TARGET_ROLES);

function buildDefaultServiceSettingsMap() {
  return SERVICE_SETTING_KEY_LIST.reduce((acc, serviceKey) => {
    acc[serviceKey] = {
      is_enabled: true,
      updated_by: null,
      updated_at: null,
    };
    return acc;
  }, {});
}

function buildDefaultUserServiceSettings(user) {
  const payoutEnabledForUser = user?.is_payout_enabled !== false;

  return {
    [SERVICE_SETTING_KEYS.VIMO_PAYOUT]: payoutEnabledForUser,
    [SERVICE_SETTING_KEYS.BRANCHX_PAYOUT]: payoutEnabledForUser,
    [SERVICE_SETTING_KEYS.CC_BILL_PAY]: true,
    [SERVICE_SETTING_KEYS.BA_CC_BILL_PAY]: true,
  };
}

function toPlainRecord(recordLike) {
  return recordLike?.toJSON ? recordLike.toJSON() : { ...recordLike };
}

function normalizeGlobalServiceSettingsMap(records) {
  const normalized = buildDefaultServiceSettingsMap();

  for (const recordLike of Array.isArray(records) ? records : []) {
    const record = toPlainRecord(recordLike);

    if (!SERVICE_SETTING_KEY_SET.has(record.service_key)) {
      continue;
    }

    normalized[record.service_key] = {
      is_enabled: record.is_enabled !== false,
      updated_by: record.updated_by ?? null,
      updated_at: record.updatedAt || record.updated_at || null,
    };
  }

  return normalized;
}

function isMissingTableError(error, tableName) {
  const message = String(error?.message || '').toLowerCase();

  return (
    message.includes(String(tableName || '').toLowerCase()) && (
      message.includes('does not exist')
      || message.includes('no such table')
      || message.includes('unknown table')
    )
  );
}

function buildMissingTableSetupError(tableName) {
  const error = new Error(`Missing required table "${tableName}". Run the latest database migrations.`);
  error.statusCode = 500;
  error.code = 'MISSING_DB_TABLE';
  return error;
}

function isExpandedUserServiceSettingsObject(recordLike) {
  return Boolean(
    recordLike
    && typeof recordLike === 'object'
    && !Array.isArray(recordLike)
    && !Object.prototype.hasOwnProperty.call(recordLike, 'service_key')
    && SERVICE_SETTING_KEY_LIST.some((serviceKey) =>
      Object.prototype.hasOwnProperty.call(recordLike, serviceKey))
  );
}

function normalizeUserServiceSettings(user, recordLikes) {
  const normalized = buildDefaultUserServiceSettings(user);

  if (!recordLikes) {
    return normalized;
  }

  if (isExpandedUserServiceSettingsObject(recordLikes)) {
    for (const serviceKey of SERVICE_SETTING_KEY_LIST) {
      if (typeof recordLikes[serviceKey] === 'boolean') {
        normalized[serviceKey] = recordLikes[serviceKey];
      }
    }

    return normalized;
  }

  for (const recordLike of Array.isArray(recordLikes) ? recordLikes : [recordLikes]) {
    const record = toPlainRecord(recordLike);

    if (!SERVICE_SETTING_KEY_SET.has(record.service_key)) {
      continue;
    }

    normalized[record.service_key] = record.is_enabled !== false;
  }

  return normalized;
}

function isUserServiceTargetRole(role) {
  return USER_SERVICE_TARGET_ROLE_SET.has(normalizeRole(role));
}

async function getServiceSettingsMap() {
  try {
    const records = await ServiceSetting.findAll({
      where: {
        service_key: {
          [Op.in]: SERVICE_SETTING_KEY_LIST,
        },
      },
      order: [['service_key', 'ASC']],
    });

    return normalizeGlobalServiceSettingsMap(records);
  } catch (error) {
    if (isMissingTableError(error, 'service_settings')) {
      return buildDefaultServiceSettingsMap();
    }

    throw error;
  }
}

async function upsertServiceSettings(updates, updatedBy) {
  const entries = Object.entries(updates || {});

  await Promise.all(entries.map(([serviceKey, isEnabled]) => ServiceSetting.upsert({
    service_key: serviceKey,
    is_enabled: isEnabled,
    updated_by: updatedBy ?? null,
  })));

  return getServiceSettingsMap();
}

async function getUserServiceSettingsMapForUsers(users, options = {}) {
  const plainUsers = (Array.isArray(users) ? users : [users])
    .filter(Boolean)
    .map((user) => toPlainRecord(user));

  const usersById = new Map();

  for (const user of plainUsers) {
    const userId = Number(user?.id);
    if (Number.isInteger(userId) && userId > 0) {
      usersById.set(userId, user);
    }
  }

  const defaultMap = new Map(
    [...usersById.entries()].map(([userId, user]) => [userId, buildDefaultUserServiceSettings(user)])
  );

  if (usersById.size === 0) {
    return defaultMap;
  }

  try {
    const records = await UserServiceSetting.findAll({
      where: {
        user_id: {
          [Op.in]: [...usersById.keys()],
        },
        service_key: {
          [Op.in]: SERVICE_SETTING_KEY_LIST,
        },
      },
      order: [['user_id', 'ASC'], ['service_key', 'ASC']],
      ...(options.transaction ? { transaction: options.transaction } : {}),
    });

    for (const recordLike of records) {
      const record = toPlainRecord(recordLike);
      const userId = Number(record.user_id);

      if (!Number.isInteger(userId) || !usersById.has(userId) || !SERVICE_SETTING_KEY_SET.has(record.service_key)) {
        continue;
      }

      const currentSettings = defaultMap.get(userId) || buildDefaultUserServiceSettings(usersById.get(userId));
      currentSettings[record.service_key] = record.is_enabled !== false;
      defaultMap.set(userId, currentSettings);
    }

    return defaultMap;
  } catch (error) {
    if (isMissingTableError(error, 'user_service_settings')) {
      if (options.transaction) {
        throw buildMissingTableSetupError('user_service_settings');
      }

      return defaultMap;
    }

    throw error;
  }
}

async function getUserServiceSettingsForUser(user, options = {}) {
  const plainUser = user ? toPlainRecord(user) : null;
  const userId = Number(plainUser?.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return buildDefaultUserServiceSettings(plainUser);
  }

  const settingsMap = await getUserServiceSettingsMapForUsers([plainUser], options);
  return settingsMap.get(userId) || buildDefaultUserServiceSettings(plainUser);
}

async function resolveUserForServiceEvaluation(userLike) {
  const plainUser = userLike ? toPlainRecord(userLike) : null;
  const userId = Number(plainUser?.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return plainUser;
  }

  if (plainUser.is_payout_enabled !== undefined) {
    return plainUser;
  }

  let dbUser;

  try {
    dbUser = await User.findByPk(userId, {
      attributes: ['id', 'role', 'status', 'franchaise_id', 'is_payout_enabled'],
    });
  } catch (error) {
    if (isMissingTableError(error, 'users')) {
      return plainUser;
    }

    throw error;
  }

  if (!dbUser) {
    return plainUser;
  }

  return toPlainRecord(dbUser);
}

function getEffectiveServiceFlags(user, serviceSettingsMap, userServiceSettings) {
  const resolvedSettings = serviceSettingsMap || buildDefaultServiceSettingsMap();
  const resolvedUserServiceSettings = normalizeUserServiceSettings(user, userServiceSettings);
  const payoutEnabledForUser = user?.is_payout_enabled !== false;

  return {
    [SERVICE_SETTING_KEYS.VIMO_PAYOUT]:
      resolvedSettings[SERVICE_SETTING_KEYS.VIMO_PAYOUT].is_enabled
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.VIMO_PAYOUT]
      && payoutEnabledForUser,
    [SERVICE_SETTING_KEYS.BRANCHX_PAYOUT]:
      resolvedSettings[SERVICE_SETTING_KEYS.BRANCHX_PAYOUT].is_enabled
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.BRANCHX_PAYOUT]
      && payoutEnabledForUser,
    [SERVICE_SETTING_KEYS.CC_BILL_PAY]:
      resolvedSettings[SERVICE_SETTING_KEYS.CC_BILL_PAY].is_enabled
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.CC_BILL_PAY],
    [SERVICE_SETTING_KEYS.BA_CC_BILL_PAY]:
      resolvedSettings[SERVICE_SETTING_KEYS.BA_CC_BILL_PAY].is_enabled
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.BA_CC_BILL_PAY],
  };
}

async function upsertUserServiceSettings(user, updates, updatedBy, options = {}) {
  const plainUser = user ? toPlainRecord(user) : null;
  const entries = Object.entries(updates || {});
  const now = new Date();
  const currentUserServiceSettings = await getUserServiceSettingsForUser(plainUser, options);
  const nextUserServiceSettings = {
    ...currentUserServiceSettings,
    ...updates,
  };

  await Promise.all(entries.map(([serviceKey, isEnabled]) => UserServiceSetting.upsert({
    user_id: plainUser.id,
    service_key: serviceKey,
    is_enabled: isEnabled,
    updated_by: updatedBy ?? null,
    updated_at: now,
  }, options.transaction ? { transaction: options.transaction } : {})));

  const shouldSyncLegacyPayoutGate = entries.some(([serviceKey]) =>
    serviceKey === SERVICE_SETTING_KEYS.VIMO_PAYOUT
    || serviceKey === SERVICE_SETTING_KEYS.BRANCHX_PAYOUT
  );

  if (shouldSyncLegacyPayoutGate) {
    user.is_payout_enabled = Boolean(
      nextUserServiceSettings[SERVICE_SETTING_KEYS.VIMO_PAYOUT]
      || nextUserServiceSettings[SERVICE_SETTING_KEYS.BRANCHX_PAYOUT]
    );

    await user.save(options.transaction ? { transaction: options.transaction } : {});
  }

  const serviceSettingsMap = await getServiceSettingsMap();

  return {
    user,
    userServiceSettings: nextUserServiceSettings,
    serviceFlags: getEffectiveServiceFlags(user, serviceSettingsMap, nextUserServiceSettings),
  };
}

function buildServiceDisabledPayload(serviceKey) {
  return {
    success: false,
    message: 'Service is currently disabled.',
    code: 'SERVICE_DISABLED',
    service_key: serviceKey,
  };
}

async function assertServiceEnabledOrRespond(res, serviceKey, user) {
  const resolvedUser = await resolveUserForServiceEvaluation(user);
  const [serviceSettingsMap, userServiceSettings] = await Promise.all([
    getServiceSettingsMap(),
    getUserServiceSettingsForUser(resolvedUser),
  ]);
  const effectiveFlags = getEffectiveServiceFlags(resolvedUser, serviceSettingsMap, userServiceSettings);

  if (effectiveFlags[serviceKey]) {
    return true;
  }

  res.status(403).json(buildServiceDisabledPayload(serviceKey));
  return false;
}

module.exports = {
  SERVICE_SETTING_KEYS,
  SERVICE_SETTING_KEY_LIST,
  SERVICE_SETTING_KEY_SET,
  USER_SERVICE_TARGET_ROLES,
  USER_SERVICE_TARGET_ROLE_SET,
  buildDefaultServiceSettingsMap,
  buildDefaultUserServiceSettings,
  getServiceSettingsMap,
  upsertServiceSettings,
  normalizeUserServiceSettings,
  isUserServiceTargetRole,
  getUserServiceSettingsMapForUsers,
  getUserServiceSettingsForUser,
  upsertUserServiceSettings,
  getEffectiveServiceFlags,
  buildServiceDisabledPayload,
  assertServiceEnabledOrRespond,
};

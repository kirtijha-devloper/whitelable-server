const { Op } = require('sequelize');
const db = require('../config/database');
const ServiceSetting = require('../models/ServiceSetting');
const UserServiceSetting = require('../models/UserServiceSetting');
const ServiceToggleAuditLog = require('../models/ServiceToggleAuditLog');
const User = require('../models/User');
const { normalizeRole } = require('../utils/permissions');

const SERVICE_SETTING_KEYS = Object.freeze({
  VIMO_PAYOUT: 'vimo_payout',
  BRANCHX_PAYOUT: 'branchx_payout',
  SEVENPAY_PAYOUT: 'sevenpay_payout',
  MX_PAYOUT: 'mx_payout',
  NDIA5_PAYOUT: 'ndia5_payout',
  CC_BILL_PAY: 'cc_bill_pay',
  BA_CC_BILL_PAY: 'ba_cc_bill_pay',
  CC_BILL_3: 'cc_bill_3',
  POS_T0_SETTLEMENT: 'pos_t0_settlement',
  USER_DAILY_LIMIT: 'user_daily_limit',
  POS_INVENTORY: 'pos_inventory',
  AADHAAR_PAY: 'aadhaar_pay',
  QR_PAYMENTS: 'qr_payments',
});

const SERVICE_SETTING_KEY_LIST = Object.freeze(Object.values(SERVICE_SETTING_KEYS));
const SERVICE_SETTING_KEY_SET = new Set(SERVICE_SETTING_KEY_LIST);

const USER_SERVICE_TARGET_ROLES = Object.freeze(['merchant', 'franchaise','super_franchise']);
const USER_SERVICE_TARGET_ROLE_SET = new Set(USER_SERVICE_TARGET_ROLES);

function buildDefaultServiceSettingsMap() {
  return SERVICE_SETTING_KEY_LIST.reduce((acc, serviceKey) => {
    acc[serviceKey] = {
      is_enabled: (serviceKey === SERVICE_SETTING_KEYS.MX_PAYOUT || serviceKey === SERVICE_SETTING_KEYS.NDIA5_PAYOUT) ? false : true,
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
    [SERVICE_SETTING_KEYS.SEVENPAY_PAYOUT]: payoutEnabledForUser,
    [SERVICE_SETTING_KEYS.MX_PAYOUT]: false,
    [SERVICE_SETTING_KEYS.NDIA5_PAYOUT]: false,
    [SERVICE_SETTING_KEYS.CC_BILL_PAY]: true,
    [SERVICE_SETTING_KEYS.BA_CC_BILL_PAY]: true,
    [SERVICE_SETTING_KEYS.CC_BILL_3]: true,
    [SERVICE_SETTING_KEYS.POS_T0_SETTLEMENT]: true,
  };
}

function toPlainRecord(recordLike) {
  return recordLike?.toJSON ? recordLike.toJSON() : { ...recordLike };
}

function normalizeGlobalServiceSettingsMap(records) {
  const normalized = buildDefaultServiceSettingsMap();

  for (const recordLike of Array.isArray(records) ? records : []) {
    const record = toPlainRecord(recordLike);

    if (!record?.service_key) {
      continue;
    }

    normalized[record.service_key] = {
      is_enabled: record.is_enabled !== false,
      updated_by: record.updated_by ?? null,
      updated_at: record.updatedAt || record.updated_at || null,
      label: record.label || null,
      category: record.category || 'General',
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
  );
}

function normalizeUserServiceSettings(user, recordLikes) {
  const normalized = buildDefaultUserServiceSettings(user);

  if (!recordLikes) {
    return normalized;
  }

  if (isExpandedUserServiceSettingsObject(recordLikes)) {
    for (const [serviceKey, val] of Object.entries(recordLikes)) {
      if (typeof val === 'boolean') {
        normalized[serviceKey] = val;
      }
    }

    return normalized;
  }

  for (const recordLike of Array.isArray(recordLikes) ? recordLikes : [recordLikes]) {
    const record = toPlainRecord(recordLike);

    if (!record?.service_key) {
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

async function upsertServiceSettings(updates, updatedBy, options = {}) {
  const entries = Object.entries(updates || {});
  const transactionOpts = options.transaction ? { transaction: options.transaction } : {};
  const currentMap = await getServiceSettingsMap();
  const requesterRole = String(options.role || options.user?.role || '').trim().toLowerCase();
  const isSuperAdmin = requesterRole === 'super_admin';

  const performingUserId = updatedBy || 1;
  const ipAddress = options.ip_address || options.ip || null;
  const userAgent = options.user_agent || null;
  const companyId = options.company_id || options.companyId || options.user?.company_id || null;

  if (isSuperAdmin) {
    // ── Super-Admin Scope: Updates Global Platform ServiceSettings ──
    await Promise.all(entries.map(([serviceKey, isEnabled]) => ServiceSetting.upsert({
      service_key: serviceKey,
      is_enabled: isEnabled,
      updated_by: updatedBy ?? null,
    }, transactionOpts)));

    for (const [serviceKey, isEnabled] of entries) {
      const previousState = Boolean(currentMap[serviceKey]?.is_enabled);
      const newState = Boolean(isEnabled);
      if (previousState !== newState) {
        await ServiceToggleAuditLog.create({
          user_id: performingUserId,
          affected_user_id: null,
          service_key: serviceKey,
          previous_state: previousState,
          new_state: newState,
          action: newState ? 'GLOBAL_ENABLE' : 'GLOBAL_DISABLE',
          ip_address: ipAddress,
          user_agent: userAgent,
          company_id: companyId,
        }, transactionOpts);
      }
    }

    // If a specific company is targeted (e.g. from AdminList.jsx company modal), sync only that company
    if (companyId) {
      const targetUsers = await User.findAll({
        where: { company_id: companyId },
        attributes: ['id'],
        ...transactionOpts,
      });

      if (targetUsers.length > 0 && entries.length > 0) {
        const now = new Date();
        const userServiceRows = [];
        for (const [serviceKey, isEnabled] of entries) {
          const isEnabledBool = Boolean(isEnabled);
          for (const u of targetUsers) {
            userServiceRows.push({
              user_id: u.id,
              service_key: serviceKey,
              is_enabled: isEnabledBool,
              updated_by: performingUserId ?? null,
              updated_at: now,
              company_id: companyId,
            });
          }
        }

        await UserServiceSetting.bulkCreate(userServiceRows, {
          updateOnDuplicate: ['is_enabled', 'updated_by', 'updated_at', 'company_id'],
          ...transactionOpts,
        });
      }
    }

    return getServiceSettingsMap();
  }

  // ── Admin Scope: Strictly Tenant / Company Isolated ──
  // 1. Enforce Super Admin Global Lock (Tier 1): Admin CANNOT enable any service disabled by Super Admin platform-wide
  for (const [serviceKey, isEnabled] of entries) {
    const isGloballyDisabled = currentMap[serviceKey]?.is_enabled === false;
    if (isEnabled && isGloballyDisabled) {
      const error = new Error(`Cannot enable '${serviceKey}'. This service has been disabled by Super Admin.`);
      error.statusCode = 403;
      error.code = 'SUPER_ADMIN_DISABLED';
      error.service_key = serviceKey;
      throw error;
    }
  }

  if (!companyId) {
    const error = new Error('Company ID is required to update admin service settings.');
    error.statusCode = 400;
    throw error;
  }

  // 1.5. Enforce Super Admin Admin-Wise Lock (Tier 2): Check if Super Admin disabled it for this admin/company
  const companyAdminUser = await User.findOne({
    where: { company_id: companyId, role: 'admin' },
    attributes: ['id'],
    ...transactionOpts,
  });

  if (companyAdminUser) {
    const superAdmins = await User.findAll({
      where: { role: 'super_admin' },
      attributes: ['id'],
      ...transactionOpts,
    });
    const superAdminIds = new Set(superAdmins.map((u) => u.id));
    superAdminIds.add(1);

    const rawAdminRecords = await UserServiceSetting.findAll({
      where: { user_id: companyAdminUser.id },
      ...transactionOpts,
    });
    const rawAdminMap = new Map();
    rawAdminRecords.forEach((r) => rawAdminMap.set(r.service_key, r.toJSON ? r.toJSON() : r));

    for (const [serviceKey, isEnabled] of entries) {
      if (!isEnabled) continue;
      const adminRec = rawAdminMap.get(serviceKey);
      const isTier2Disabled = adminRec && adminRec.is_enabled === false && superAdminIds.has(Number(adminRec.updated_by));
      if (isTier2Disabled) {
        const error = new Error(`Cannot enable '${serviceKey}'. This service has been disabled for your company by Super Admin.`);
        error.statusCode = 403;
        error.code = 'SUPER_ADMIN_DISABLED';
        error.service_key = serviceKey;
        throw error;
      }
    }
  }

  // 2. Tenant Isolation: Find all users under THIS Admin's company only
  const targetUsers = await User.findAll({
    where: { company_id: companyId },
    attributes: ['id', 'role'],
    ...transactionOpts,
  });

  const userIds = new Set(targetUsers.map((u) => u.id));
  if (options.user?.id) {
    userIds.add(Number(options.user.id));
  }

  if (userIds.size > 0 && entries.length > 0) {
    const now = new Date();
    const userServiceRows = [];
    for (const [serviceKey, isEnabled] of entries) {
      const isEnabledBool = Boolean(isEnabled);
      for (const uid of userIds) {
        userServiceRows.push({
          user_id: uid,
          service_key: serviceKey,
          is_enabled: isEnabledBool,
          updated_by: performingUserId ?? null,
          updated_at: now,
          company_id: companyId,
        });
      }

      await ServiceToggleAuditLog.create({
        user_id: performingUserId,
        affected_user_id: null,
        service_key: serviceKey,
        previous_state: null,
        new_state: isEnabledBool,
        action: isEnabledBool ? 'COMPANY_ENABLE' : 'COMPANY_DISABLE',
        ip_address: ipAddress,
        user_agent: userAgent,
        company_id: companyId,
      }, transactionOpts);
    }

    await UserServiceSetting.bulkCreate(userServiceRows, {
      updateOnDuplicate: ['is_enabled', 'updated_by', 'updated_at', 'company_id'],
      ...transactionOpts,
    });
  }

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
      },
      order: [['user_id', 'ASC'], ['service_key', 'ASC']],
      ...(options.transaction ? { transaction: options.transaction } : {}),
    });

    for (const recordLike of records) {
      const record = toPlainRecord(recordLike);
      const userId = Number(record.user_id);

      if (!Number.isInteger(userId) || !usersById.has(userId) || !record.service_key) {
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

function getEffectiveServiceFlags(user, serviceSettingsMap, userServiceSettings, companyAdminSettings) {
  const resolvedSettings = serviceSettingsMap || buildDefaultServiceSettingsMap();
  const resolvedUserServiceSettings = normalizeUserServiceSettings(user, userServiceSettings);
  const payoutEnabledForUser = user?.is_payout_enabled !== false;
  const adminOverrides = companyAdminSettings || user?.company_admin_service_settings || null;

  const flags = {
    [SERVICE_SETTING_KEYS.VIMO_PAYOUT]:
      resolvedSettings[SERVICE_SETTING_KEYS.VIMO_PAYOUT]?.is_enabled !== false
      && (adminOverrides ? adminOverrides[SERVICE_SETTING_KEYS.VIMO_PAYOUT] !== false : true)
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.VIMO_PAYOUT] !== false
      && payoutEnabledForUser,
    [SERVICE_SETTING_KEYS.BRANCHX_PAYOUT]:
      resolvedSettings[SERVICE_SETTING_KEYS.BRANCHX_PAYOUT]?.is_enabled !== false
      && (adminOverrides ? adminOverrides[SERVICE_SETTING_KEYS.BRANCHX_PAYOUT] !== false : true)
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.BRANCHX_PAYOUT] !== false
      && payoutEnabledForUser,
    [SERVICE_SETTING_KEYS.SEVENPAY_PAYOUT]:
      resolvedSettings[SERVICE_SETTING_KEYS.SEVENPAY_PAYOUT]?.is_enabled !== false
      && (adminOverrides ? adminOverrides[SERVICE_SETTING_KEYS.SEVENPAY_PAYOUT] !== false : true)
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.SEVENPAY_PAYOUT] !== false
      && payoutEnabledForUser,
    [SERVICE_SETTING_KEYS.MX_PAYOUT]:
      resolvedSettings[SERVICE_SETTING_KEYS.MX_PAYOUT]?.is_enabled !== false
      && (adminOverrides ? adminOverrides[SERVICE_SETTING_KEYS.MX_PAYOUT] !== false : true)
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.MX_PAYOUT] !== false
      && payoutEnabledForUser,
    [SERVICE_SETTING_KEYS.NDIA5_PAYOUT]:
      resolvedSettings[SERVICE_SETTING_KEYS.NDIA5_PAYOUT]?.is_enabled !== false
      && (adminOverrides ? adminOverrides[SERVICE_SETTING_KEYS.NDIA5_PAYOUT] !== false : true)
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.NDIA5_PAYOUT] !== false
      && payoutEnabledForUser,
    [SERVICE_SETTING_KEYS.CC_BILL_PAY]:
      resolvedSettings[SERVICE_SETTING_KEYS.CC_BILL_PAY]?.is_enabled !== false
      && (adminOverrides ? adminOverrides[SERVICE_SETTING_KEYS.CC_BILL_PAY] !== false : true)
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.CC_BILL_PAY] !== false,
    [SERVICE_SETTING_KEYS.BA_CC_BILL_PAY]:
      resolvedSettings[SERVICE_SETTING_KEYS.BA_CC_BILL_PAY]?.is_enabled !== false
      && (adminOverrides ? adminOverrides[SERVICE_SETTING_KEYS.BA_CC_BILL_PAY] !== false : true)
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.BA_CC_BILL_PAY] !== false,
    [SERVICE_SETTING_KEYS.CC_BILL_3]:
      resolvedSettings[SERVICE_SETTING_KEYS.CC_BILL_3]?.is_enabled !== false
      && (adminOverrides ? adminOverrides[SERVICE_SETTING_KEYS.CC_BILL_3] !== false : true)
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.CC_BILL_3] !== false,
    [SERVICE_SETTING_KEYS.POS_T0_SETTLEMENT]:
      resolvedSettings[SERVICE_SETTING_KEYS.POS_T0_SETTLEMENT]?.is_enabled !== false
      && (adminOverrides ? adminOverrides[SERVICE_SETTING_KEYS.POS_T0_SETTLEMENT] !== false : true)
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.POS_T0_SETTLEMENT] !== false,
    [SERVICE_SETTING_KEYS.USER_DAILY_LIMIT]:
      resolvedSettings[SERVICE_SETTING_KEYS.USER_DAILY_LIMIT]?.is_enabled !== false
      && (adminOverrides ? adminOverrides[SERVICE_SETTING_KEYS.USER_DAILY_LIMIT] !== false : true)
      && resolvedUserServiceSettings[SERVICE_SETTING_KEYS.USER_DAILY_LIMIT] !== false,
    pos_inventory:
      resolvedSettings['pos_inventory']?.is_enabled !== false
      && (adminOverrides ? adminOverrides['pos_inventory'] !== false : true)
      && resolvedUserServiceSettings['pos_inventory'] !== false,
    aadhaar_pay:
      resolvedSettings['aadhaar_pay']?.is_enabled !== false
      && (adminOverrides ? adminOverrides['aadhaar_pay'] !== false : true)
      && resolvedUserServiceSettings['aadhaar_pay'] !== false,
    qr_payments:
      resolvedSettings['qr_payments']?.is_enabled !== false
      && (adminOverrides ? adminOverrides['qr_payments'] !== false : true)
      && resolvedUserServiceSettings['qr_payments'] !== false,
  };

  // Dynamically include any other services in resolvedSettings
  for (const [key, meta] of Object.entries(resolvedSettings)) {
    if (flags[key] === undefined) {
      flags[key] = meta?.is_enabled !== false
        && (adminOverrides ? adminOverrides[key] !== false : true)
        && resolvedUserServiceSettings[key] !== false;
    }
  }

  return flags;
}

async function upsertUserServiceSettings(user, updates, updatedBy, options = {}) {
  const plainUser = user ? toPlainRecord(user) : null;
  const entries = Object.entries(updates || {});
  const now = new Date();
  const currentUserServiceSettings = await getUserServiceSettingsForUser(plainUser, options);
  const serviceSettingsMap = await getServiceSettingsMap();
  const transactionOpts = options.transaction ? { transaction: options.transaction } : {};
  const companyId = options.company_id || options.companyId || (user && user.company_id) || null;

  // Tier 1: Enforce Super Admin Global Lock
  for (const [serviceKey, isEnabled] of entries) {
    if (isEnabled && serviceSettingsMap[serviceKey]?.is_enabled === false) {
      const error = new Error(`Cannot enable '${serviceKey}'. This service has been disabled by Super Admin.`);
      error.statusCode = 403;
      error.code = 'SUPER_ADMIN_DISABLED';
      error.service_key = serviceKey;
      throw error;
    }
  }

  // Tier 2 & Tier 3: Enforce Super Admin Admin-Wise Lock & Admin Global Lock for company users
  if (companyId) {
    const adminUser = await User.findOne({
      where: { company_id: companyId, role: 'admin' },
      attributes: ['id'],
      ...transactionOpts,
    });

    if (adminUser) {
      const superAdmins = await User.findAll({
        where: { role: 'super_admin' },
        attributes: ['id'],
        ...transactionOpts,
      });
      const superAdminIds = new Set(superAdmins.map((u) => u.id));
      superAdminIds.add(1);

      const rawAdminRecords = await UserServiceSetting.findAll({
        where: { user_id: adminUser.id },
        ...transactionOpts,
      });
      const rawAdminMap = new Map();
      rawAdminRecords.forEach((r) => rawAdminMap.set(r.service_key, r.toJSON ? r.toJSON() : r));

      const adminUserSettings = await getUserServiceSettingsForUser(adminUser, options);

      for (const [serviceKey, isEnabled] of entries) {
        if (!isEnabled) continue;

        const adminRec = rawAdminMap.get(serviceKey);
        const isTier2Disabled = adminRec && adminRec.is_enabled === false && superAdminIds.has(Number(adminRec.updated_by));
        if (isTier2Disabled) {
          const error = new Error(`Cannot enable '${serviceKey}'. This service has been disabled for your company by Super Admin.`);
          error.statusCode = 403;
          error.code = 'SUPER_ADMIN_DISABLED';
          error.service_key = serviceKey;
          throw error;
        }

        const isAdminGlobalDisabled = adminUserSettings[serviceKey] === false;
        if (isAdminGlobalDisabled) {
          const error = new Error(`Cannot enable '${serviceKey}' for this user. This service is disabled in your organization's global settings by Admin.`);
          error.statusCode = 403;
          error.code = 'ADMIN_GLOBAL_DISABLED';
          error.service_key = serviceKey;
          throw error;
        }
      }
    }
  }

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
    company_id: companyId,
  }, transactionOpts)));

  const performingUserId = updatedBy || plainUser.id;
  const ipAddress = options.ip_address || options.ip || null;
  const userAgent = options.user_agent || null;

  for (const [serviceKey, isEnabled] of entries) {
    const previousState = Boolean(currentUserServiceSettings[serviceKey]);
    const newState = Boolean(isEnabled);
    if (previousState !== newState) {
      await ServiceToggleAuditLog.create({
        user_id: performingUserId,
        affected_user_id: plainUser.id,
        service_key: serviceKey,
        previous_state: previousState,
        new_state: newState,
        action: newState ? 'ENABLE' : 'DISABLE',
        ip_address: ipAddress,
        user_agent: userAgent,
        company_id: companyId,
      }, transactionOpts);
    }
  }

  const shouldSyncLegacyPayoutGate = entries.some(([serviceKey]) =>
    serviceKey === SERVICE_SETTING_KEYS.VIMO_PAYOUT
    || serviceKey === SERVICE_SETTING_KEYS.BRANCHX_PAYOUT
    || serviceKey === SERVICE_SETTING_KEYS.SEVENPAY_PAYOUT
    || serviceKey === SERVICE_SETTING_KEYS.MX_PAYOUT
    || serviceKey === SERVICE_SETTING_KEYS.NDIA5_PAYOUT
  );

  if (shouldSyncLegacyPayoutGate) {
    user.is_payout_enabled = Boolean(
      nextUserServiceSettings[SERVICE_SETTING_KEYS.VIMO_PAYOUT]
      || nextUserServiceSettings[SERVICE_SETTING_KEYS.BRANCHX_PAYOUT]
      || nextUserServiceSettings[SERVICE_SETTING_KEYS.SEVENPAY_PAYOUT]
      || nextUserServiceSettings[SERVICE_SETTING_KEYS.MX_PAYOUT]
      || nextUserServiceSettings[SERVICE_SETTING_KEYS.NDIA5_PAYOUT]
    );

    await user.save(options.transaction ? { transaction: options.transaction } : {});
  }

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

async function getServiceToggleAuditLogs(filters = {}) {
  const where = {};

  if (filters.userId) {
    where.user_id = Number(filters.userId);
  }
  if (filters.affectedUserId) {
    where.affected_user_id = Number(filters.affectedUserId);
  }
  if (filters.serviceKey) {
    where.service_key = String(filters.serviceKey).trim();
  }

  if (filters.startDate || filters.endDate) {
    const createdAtWhere = {};

    if (filters.startDate) {
      const startStr = String(filters.startDate).trim().split('T')[0];
      const start = new Date(`${startStr}T00:00:00.000Z`);
      if (!isNaN(start.getTime())) {
        createdAtWhere[Op.gte] = start;
      }
    }
    if (filters.endDate) {
      const endStr = String(filters.endDate).trim().split('T')[0];
      const end = new Date(`${endStr}T23:59:59.999Z`);
      if (!isNaN(end.getTime())) {
        createdAtWhere[Op.lte] = end;
      }
    }
    if (Object.keys(createdAtWhere).length > 0) {
      where.createdAt = createdAtWhere;
    }
  }

  const search = String(filters.search || filters.q || filters.targetUser || '').trim();
  const models = require('../models/initAssociations');
  const UserModel = models.User || User;

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
  const offset = (page - 1) * limit;

  if (search) {
    const isSqlite = db.options?.dialect === 'sqlite';
    const likeOp = isSqlite ? Op.like : Op.iLike;
    const searchPattern = `%${search}%`;

    const matchingUsers = await UserModel.findAll({
      where: {
        [Op.or]: [
          { name: { [likeOp]: searchPattern } },
          { username: { [likeOp]: searchPattern } },
          { mobile_number: { [likeOp]: searchPattern } },
          { abheepay_id: { [likeOp]: searchPattern } },
          { email: { [likeOp]: searchPattern } },
        ],
      },
      attributes: ['id'],
      raw: true,
    });

    const matchingUserIds = matchingUsers.map((u) => u.id);

    if (matchingUserIds.length === 0) {
      return {
        count: 0,
        page,
        limit,
        totalPages: 1,
        data: [],
      };
    }

    where[Op.or] = [
      { affected_user_id: { [Op.in]: matchingUserIds } },
      { user_id: { [Op.in]: matchingUserIds } },
    ];
  }

  const { count, rows } = await ServiceToggleAuditLog.findAndCountAll({
    where,
    include: [
      {
        model: UserModel,
        as: 'performingUser',
        attributes: ['id', 'name', 'abheepay_id', 'role', 'mobile_number'],
      },
      {
        model: UserModel,
        as: 'affectedUser',
        attributes: ['id', 'name', 'abheepay_id', 'role', 'mobile_number'],
      },
    ],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });

  return {
    count,
    page,
    limit,
    totalPages: Math.ceil(count / limit) || 1,
    data: rows,
  };
}

async function bulkUpdateUserServiceSettingsForAllUsers(serviceKey, isEnabled, performingUserId, options = {}) {
  const isEnabledBool = Boolean(isEnabled);
  const now = new Date();
  const currentGlobalMap = await getServiceSettingsMap();

  if (isEnabledBool && currentGlobalMap[serviceKey]?.is_enabled === false) {
    const error = new Error(`Cannot enable '${serviceKey}'. This service has been disabled by Super Admin.`);
    error.statusCode = 403;
    error.code = 'SUPER_ADMIN_DISABLED';
    error.service_key = serviceKey;
    throw error;
  }

  const companyId = options.company_id || options.companyId || null;
  const userWhere = {
    role: { [Op.in]: ['merchant', 'franchaise', 'super_franchise'] },
  };
  if (companyId) {
    userWhere.company_id = companyId;
  }

  // Find all merchant and franchise users (filtered by company if provided)
  const targetUsers = await User.findAll({
    where: userWhere,
    attributes: ['id', 'role', 'status', 'is_payout_enabled', 'settlement_type'],
  });

  if (targetUsers.length === 0) {
    return { affected_count: 0, service_key: serviceKey, is_enabled: isEnabledBool };
  }

  const transactionOpts = options.transaction ? { transaction: options.transaction } : {};

  // Handle special master service keys
  if (serviceKey === 'pos_t0_settlement') {
    const newSettlementType = isEnabledBool ? 'T0' : 'T1';
    await User.update(
      { settlement_type: newSettlementType },
      {
        where: { role: { [Op.in]: ['merchant', 'franchaise', 'super_franchise'] } },
        ...transactionOpts,
      }
    );
  }

  // Also update user_service_settings for the serviceKey across all target users
  const rows = targetUsers.map((u) => ({
    user_id: u.id,
    service_key: serviceKey,
    is_enabled: isEnabledBool,
    updated_by: performingUserId ?? null,
    updated_at: now,
    company_id: companyId,
  }));

  await UserServiceSetting.bulkCreate(rows, {
    updateOnDuplicate: ['is_enabled', 'updated_by', 'updated_at', 'company_id'],
    ...transactionOpts,
  });

  // Sync is_payout_enabled if service is a payout service
  const isPayoutService = [
    SERVICE_SETTING_KEYS.VIMO_PAYOUT,
    SERVICE_SETTING_KEYS.BRANCHX_PAYOUT,
    SERVICE_SETTING_KEYS.SEVENPAY_PAYOUT,
    SERVICE_SETTING_KEYS.MX_PAYOUT,
    SERVICE_SETTING_KEYS.NDIA5_PAYOUT,
  ].includes(serviceKey);

  if (isPayoutService) {
    if (isEnabledBool) {
      await User.update(
        { is_payout_enabled: true },
        {
          where: { role: { [Op.in]: ['merchant', 'franchaise'] } },
          ...transactionOpts,
        }
      );
    }
  }

  // Also update global default service_settings table
  await ServiceSetting.upsert({
    service_key: serviceKey,
    is_enabled: isEnabledBool,
    updated_by: performingUserId ?? null,
  }, transactionOpts);

  // Record audit log
  const ipAddress = options.ip_address || options.ip || null;
  const userAgent = options.user_agent || null;

  await ServiceToggleAuditLog.create({
    user_id: performingUserId || 1,
    affected_user_id: null,
    service_key: serviceKey,
    previous_state: !isEnabledBool,
    new_state: isEnabledBool,
    action: `BULK_${isEnabledBool ? 'ENABLE' : 'DISABLE'}_ALL`,
    ip_address: ipAddress,
    user_agent: userAgent,
    company_id: companyId,
  }, transactionOpts);

  return {
    affected_count: targetUsers.length,
    service_key: serviceKey,
    is_enabled: isEnabledBool,
  };
}

/**
 * Gets boolean flag value for a global service setting key
 */
async function getServiceFlagValue(serviceKey, defaultValue = true) {
  try {
    const map = await getServiceSettingsMap();
    if (map && map[serviceKey] !== undefined) {
      return map[serviceKey].is_enabled !== false;
    }
    return defaultValue;
  } catch (err) {
    return defaultValue;
  }
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
  bulkUpdateUserServiceSettingsForAllUsers,
  getEffectiveServiceFlags,
  buildServiceDisabledPayload,
  assertServiceEnabledOrRespond,
  getServiceToggleAuditLogs,
  getServiceFlagValue,
};

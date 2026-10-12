const asyncHandler = require('express-async-handler');
const db = require('../config/database');
const User = require('../models/User');
const ServiceSetting = require('../models/ServiceSetting');
const {
  SERVICE_SETTING_KEY_LIST,
  isUserServiceTargetRole,
  getServiceSettingsMap,
  upsertServiceSettings,
  upsertUserServiceSettings,
  bulkUpdateUserServiceSettingsForAllUsers,
  getServiceToggleAuditLogs,
} = require('../services/serviceSettingsService');
const { normalizeRole } = require('../utils/permissions');

const DEFAULT_SERVICES_METADATA = [
  {
    key: 'vimo_payout',
    label: 'Vimo Payout',
    category: 'Payout & Banking',
    description: 'Vimo Native Payout Gateway Integration',
    target_roles: ['admin', 'franchise', 'merchant'],
  },
  {
    key: 'branchx_payout',
    label: 'BranchX Payout',
    category: 'Payout & Banking',
    description: 'BranchX Direct Payout Service',
    target_roles: ['admin', 'franchise', 'merchant'],
  },
  {
    key: 'sevenpay_payout',
    label: 'SevenPay Payout',
    category: 'Payout & Banking',
    description: 'SevenPay Payout Gateway Integration',
    target_roles: ['admin', 'franchise', 'merchant'],
  },
  {
    key: 'ndia5_payout',
    label: 'Ndia5 Payout',
    category: 'Payout & Banking',
    description: 'NDIA5 Direct Bank Settlement Gateway',
    target_roles: ['admin', 'franchise', 'merchant'],
  },
  {
    key: 'cc_bill_pay',
    label: 'Credit Card Bill Pay',
    category: 'Bill Payments & BBPS',
    description: 'Direct Credit Card Bill Payment Engine',
    target_roles: ['admin', 'franchise', 'merchant'],
  },
  {
    key: 'ba_cc_bill_pay',
    label: 'BillAvenue CC Bill Pay',
    category: 'Bill Payments & BBPS',
    description: 'BillAvenue BBPS Credit Card Bill Payment',
    target_roles: ['admin', 'franchise', 'merchant'],
  },
  {
    key: 'cc_bill_3',
    label: 'CC Bill Pay 3.0',
    category: 'Bill Payments & BBPS',
    description: 'High-speed CC Settlement Engine v3',
    target_roles: ['admin', 'franchise', 'merchant'],
  },
  {
    key: 'mx_payout',
    label: 'MeroRecharge Payout',
    category: 'Payout & Banking',
    description: 'MeroRecharge MX Payout Integration',
    target_roles: ['admin', 'franchise', 'merchant'],
  },
  {
    key: 'pos_t0_settlement',
    label: 'POS T0 Instant Settlement',
    category: 'POS & Hardware',
    description: 'Instant same-day T0 POS Settlement',
    target_roles: ['admin', 'franchise', 'merchant', 'super_franchise'],
  },
  {
    key: 'user_daily_limit',
    label: 'User Daily Transaction Limit',
    category: 'Security & Limits',
    description: 'Daily transaction volume limit per user',
    target_roles: ['admin', 'franchise', 'merchant'],
  },
  {
    key: 'pos_inventory',
    label: 'POS Inventory & Rentals',
    category: 'POS & Hardware',
    description: 'POS Machine Inventory & Terminal Management',
    target_roles: ['admin', 'franchise', 'merchant', 'super_franchise'],
  },
  {
    key: 'aadhaar_pay',
    label: 'Aadhaar Pay',
    category: 'Payout & Banking',
    description: 'Biometric Aadhaar withdrawal service',
    target_roles: ['admin', 'franchise', 'merchant'],
  },
  {
    key: 'qr_payments',
    label: 'QR & Soundbox Payments',
    category: 'POS & Hardware',
    description: '4G Soundbox & Standee QR payments',
    target_roles: ['admin', 'franchise', 'merchant'],
  },
];

function getValidatedServiceSettingsPayload(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body)
    ? body
    : {};

  const entries = Object.entries(payload);

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
  if (!req) return { ip_address: '127.0.0.1', user_agent: null };

  const forwarded = req.headers
    ? (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['cf-connecting-ip'])
    : null;
  let ip_address = null;

  if (forwarded) {
    const rawIp = String(forwarded).split(',')[0].trim();
    const cleanIp = rawIp.startsWith('::ffff:') ? rawIp.replace('::ffff:', '') : rawIp;
    if (cleanIp && cleanIp !== '::1' && cleanIp !== '127.0.0.1') {
      ip_address = cleanIp;
    }
  }

  if (!ip_address) {
    let fallbackIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || null;
    if (fallbackIp) {
      if (fallbackIp.startsWith('::ffff:')) {
        fallbackIp = fallbackIp.replace('::ffff:', '');
      }
      if (fallbackIp === '::1') {
        fallbackIp = '127.0.0.1';
      }
      ip_address = fallbackIp;
    }
  }

  const user_agent = req.headers && req.headers['user-agent']
    ? String(req.headers['user-agent']).substring(0, 500)
    : null;

  return {
    ip_address: ip_address || '127.0.0.1',
    user_agent,
    company_id: req.company || null,
  };
}

/**
 * GET /super-admin/services & GET /admin/service-settings
 * Returns all services with status & metadata array
 */
const getServicesListController = asyncHandler(async (_req, res) => {
  const dbServices = await ServiceSetting.findAll();
  const dbMap = new Map();

  dbServices.forEach((s) => {
    dbMap.set(s.service_key, s.toJSON ? s.toJSON() : s);
  });

  const merged = DEFAULT_SERVICES_METADATA.map((meta) => {
    const dbRecord = dbMap.get(meta.key);
    return {
      key: meta.key,
      service_key: meta.key,
      label: dbRecord?.label || meta.label,
      category: dbRecord?.category || meta.category,
      description: dbRecord?.description || meta.description,
      is_enabled: dbRecord ? dbRecord.is_enabled !== false : true,
      target_roles: dbRecord?.target_roles || meta.target_roles,
    };
  });

  // Include any extra custom services created in DB
  dbServices.forEach((s) => {
    if (!DEFAULT_SERVICES_METADATA.some((m) => m.key === s.service_key)) {
      merged.push({
        key: s.service_key,
        service_key: s.service_key,
        label: s.label || s.service_key,
        category: s.category || 'General',
        description: s.description || '',
        is_enabled: s.is_enabled !== false,
        target_roles: s.target_roles || ['admin', 'franchise', 'merchant'],
      });
    }
  });

  return res.status(200).json({
    success: true,
    data: merged,
  });
});

/**
 * PUT /super-admin/services/:key/status & PUT /super-admin/services/status
 * Updates status of a single service (or batch)
 */



const updateServiceStatusController = asyncHandler(async (req, res) => {
  const serviceKey = req.params.key || req.body.service_key || req.body.key;
  const isEnabled = req.body.is_enabled;
  
  if (!serviceKey || typeof isEnabled !== 'boolean') {
    return res.status(400).json({
      success: false,
      message: 'service_key and boolean is_enabled are required.',
    });
  }
  
  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  const context = extractRequestContext(req);
  context.role = req.user?.role;
  context.user = req.user;
  await upsertServiceSettings({ [serviceKey]: isEnabled }, req.user?.id || null, context);

  let record = await ServiceSetting.findOne({ where: { service_key: serviceKey } });
  if (!record) {
    const meta = DEFAULT_SERVICES_METADATA.find((m) => m.key === serviceKey) || {};
    record = await ServiceSetting.create({
      service_key: serviceKey,
      label: meta.label || serviceKey,
      category: meta.category || 'General',
      description: meta.description || '',
      is_enabled: isEnabled,
      target_roles: meta.target_roles || ['admin', 'franchise', 'merchant'],
      company_id : companyId
    });
  }

  return res.status(200).json({
    success: true,
    message: `Service '${serviceKey}' status updated to ${isEnabled ? 'enabled' : 'disabled'}.`,
    data: {
      key: serviceKey,
      service_key: serviceKey,
      is_enabled: isEnabled,
      label: record.label || serviceKey,
      category: record.category,
    },
  });
});

/**
 * POST /super-admin/services/create
 * Creates a new custom service
 */
const createServiceController = asyncHandler(async (req, res) => {
  const { key, service_key, label, category = 'General', description = '', is_enabled = true, target_roles = ['admin', 'franchise', 'merchant'] } = req.body;
  const finalKey = key || service_key;

  if (!finalKey || !label) {
    return res.status(400).json({
      success: false,
      message: 'Service key and label are required.',
    });
  }
  
  const existing = await ServiceSetting.findOne({ where: { service_key: finalKey } });
  if (existing) {
    existing.label = label;
    existing.category = category;
    existing.description = description;
    existing.is_enabled = Boolean(is_enabled);
    existing.target_roles = target_roles;
    await existing.save();
    
    return res.status(200).json({
      success: true,
      message: `Service '${finalKey}' updated successfully.`,
      data: existing,
    });
  }
  
  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  const created = await ServiceSetting.create({
    service_key: finalKey,
    label,
    category,
    description,
    is_enabled: Boolean(is_enabled),
    target_roles,
    company_id : companyId
  });

  return res.status(201).json({
    success: true,
    message: `Service '${finalKey}' created successfully.`,
    data: created,
  });
});

const getServiceSettings = asyncHandler(async (req, res) => {
  const { getUserServiceSettingsForUser } = require('../services/serviceSettingsService');
  const UserServiceSetting = require('../models/UserServiceSetting');
  const globalMap = await getServiceSettingsMap();
  const requesterRole = String(req.user?.role || '').toLowerCase();

  if (requesterRole === 'admin' || requesterRole === 'employee') {
    const companyId = req.company || req.user?.company_id;
    let targetAdminUser = req.user;
    if (requesterRole === 'employee' && companyId) {
      const companyAdmin = await User.findOne({
        where: { company_id: companyId, role: 'admin' },
      });
      if (companyAdmin) {
        targetAdminUser = companyAdmin;
      }
    }

    const superAdmins = await User.findAll({
      where: { role: 'super_admin' },
      attributes: ['id'],
    });
    const superAdminIds = new Set(superAdmins.map((u) => u.id));
    superAdminIds.add(1);

    const rawAdminRecords = await UserServiceSetting.findAll({
      where: { user_id: targetAdminUser.id },
    });
    const rawAdminMap = new Map();
    rawAdminRecords.forEach((r) => rawAdminMap.set(r.service_key, r.toJSON ? r.toJSON() : r));

    const adminUserSettings = await getUserServiceSettingsForUser(targetAdminUser);
    const result = {};
    for (const [key, globalCfg] of Object.entries(globalMap)) {
      const isTier1Disabled = globalCfg.is_enabled === false;
      const adminRec = rawAdminMap.get(key);
      const isTier2Disabled = adminRec && adminRec.is_enabled === false && superAdminIds.has(Number(adminRec.updated_by));
      const isSuperAdminDisabled = isTier1Disabled || Boolean(isTier2Disabled);

      const adminEnabled = adminUserSettings[key] !== false;
      result[key] = {
        ...globalCfg,
        is_enabled: isSuperAdminDisabled ? false : adminEnabled,
        is_super_admin_disabled: isSuperAdminDisabled,
        admin_enabled: adminEnabled,
      };
    }
    return res.status(200).json({
      success: true,
      data: result,
    });
  }

  return res.status(200).json({
    success: true,
    data: globalMap,
  });
});

const updateServiceSettings = asyncHandler(async (req, res) => {
  const companyId = req.company || req.user?.company_id;

  if (!companyId) {
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({ message: "No Domain Name is registered" });
  }

  const { payload, error } = getValidatedServiceSettingsPayload(req.body);

  if (error) {
    return res.status(error.status).json(error.body);
  }

  const context = extractRequestContext(req);
  context.role = req.user?.role;
  context.user = req.user;
  context.company_id = companyId;

  try {
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
  } catch (err) {
    if (err.code === 'SUPER_ADMIN_DISABLED' || err.statusCode === 403) {
      return res.status(403).json({
        success: false,
        message: err.message,
        code: err.code || 'SUPER_ADMIN_DISABLED',
        service_key: err.service_key || null,
      });
    }
    throw err;
  }
});

const updateUserServiceSettings = asyncHandler(async (req, res) => {
  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

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
  try {
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
  } catch (err) {
    if (err.code === 'SUPER_ADMIN_DISABLED' || err.code === 'ADMIN_GLOBAL_DISABLED' || err.statusCode === 403) {
      return res.status(403).json({
        success: false,
        message: err.message,
        code: err.code || 'SERVICE_DISABLED',
        service_key: err.service_key || null,
      });
    }
    throw err;
  }
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
    search: req.query.search || req.query.q || req.query.target_user || req.query.targetUser,
    startDate: req.query.start_date || req.query.startDate,
    endDate: req.query.end_date || req.query.endDate,
    page: req.query.page,
    limit: req.query.limit,
  };

  const result = await getServiceToggleAuditLogs(filters);

  return res.status(200).json({
    success: true,
    ...result,
  });
});

const bulkUpdateUserServiceSettings = asyncHandler(async (req, res) => {
  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  const requesterRole = normalizeRole(req.user?.role);

  if (requesterRole !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Only admin can perform bulk service updates across all users.',
    });
  }

  const { service_key, is_enabled } = req.body || {};

  if (!service_key || typeof is_enabled !== 'boolean') {
    return res.status(400).json({
      success: false,
      message: 'Valid service_key and boolean is_enabled are required.',
    });
  }

  try {
    const context = extractRequestContext(req);
    context.company_id = companyId;
    const result = await db.transaction(async (transaction) => {
      return await bulkUpdateUserServiceSettingsForAllUsers(
        service_key,
        is_enabled,
        req.user?.id || null,
        {
          transaction,
          ...context,
        }
      );
    });

    return res.status(200).json({
      success: true,
      message: `Successfully ${is_enabled ? 'enabled' : 'disabled'} ${service_key} for all ${result.affected_count} users.`,
      data: result,
    });
  } catch (err) {
    if (err.code === 'SUPER_ADMIN_DISABLED' || err.statusCode === 403) {
      return res.status(403).json({
        success: false,
        message: err.message,
        code: err.code || 'SUPER_ADMIN_DISABLED',
        service_key: err.service_key || null,
      });
    }
    throw err;
  }
});

module.exports = {
  getServiceSettings,
  updateServiceSettings,
  updateUserServiceSettings,
  bulkUpdateUserServiceSettings,
  getServiceToggleAuditLogsController,
  getServicesListController,
  updateServiceStatusController,
  createServiceController,
};

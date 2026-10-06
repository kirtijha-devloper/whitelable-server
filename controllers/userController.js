const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const  User = require('../models/User');
const EmployeeAccessRole = require('../models/EmployeeAccessRole');
const db = require('../config/database');
const UsernameSequence = require('../models/UsernameSequence');
const ServiceToggleAuditLog = require('../models/ServiceToggleAuditLog');
const { validateMerchantT0Limit } = require('../services/settlementService');

function extractClientIp(req) {
  if (!req) return '127.0.0.1';
  const forwarded = req.headers
    ? (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['cf-connecting-ip'])
    : null;
  if (forwarded) {
    const rawIp = String(forwarded).split(',')[0].trim();
    const cleanIp = rawIp.startsWith('::ffff:') ? rawIp.replace('::ffff:', '') : rawIp;
    if (cleanIp && cleanIp !== '::1' && cleanIp !== '127.0.0.1') {
      return cleanIp;
    }
  }

  let fallbackIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || null;
  if (fallbackIp) {
    if (fallbackIp.startsWith('::ffff:')) {
      fallbackIp = fallbackIp.replace('::ffff:', '');
    }
    if (fallbackIp === '::1') {
      fallbackIp = '127.0.0.1';
    }
    return fallbackIp;
  }

  return '127.0.0.1';
}

const fs = require("fs");
const path = require("path");

// file-based logger for authentication diagnosis
const AUTH_LOG_DIR = path.join(__dirname, "../logs");
const AUTH_LOG_FILE = path.join(AUTH_LOG_DIR, "auth.log");
if (!fs.existsSync(AUTH_LOG_DIR)) {
  fs.mkdirSync(AUTH_LOG_DIR, { recursive: true });
}
function _authTs() {
  return new Date().toISOString();
}
function _authFileLog(level, args) {
  const parts = args.map((a) =>
    a instanceof Error
      ? `${a.message}\n${a.stack}`
      : typeof a === "object" && a !== null
      ? JSON.stringify(a, null, 2)
      : String(a)
  );
  const line = `[${_authTs()}] [${level}] ${parts.join(" ")}\n`;
  try {
    fs.appendFileSync(AUTH_LOG_FILE, line);
  } catch (_) { /* ignore */ }
}
const authLogger = {
  log:   (...args) => { console.log(...args);   _authFileLog("INFO",  args); },
  warn:  (...args) => { console.warn(...args);  _authFileLog("WARN",  args); },
  error: (...args) => { console.error(...args); _authFileLog("ERROR", args); },
};
const {
  hasActiveTpin,
  replaceTpin,
  verifyTpinForUser,
} = require('../services/tpinService');
const { Op, fn, col } = require('sequelize');
const PosMachine = require("../models/posMachine");
const OTP = require("../models/Otp");
const sendOtpHelper = require("../utils/sendOtp");
const { sendRegistrationSms } = require("../utils/sendOtp");
const sendEmailOtp = require("../utils/emailOtp");
const { sendMail } = require("../utils/mail");

const PosTransactionCharge = require('../models/PosTransactionCharge');
const PayoutCharge = require('../models/PayoutCharge');
const Rental = require('../models/Rental');
const ledgerService = require('../services/ledgerService');
const {
  getServiceSettingsMap,
  buildDefaultUserServiceSettings,
  getEffectiveServiceFlags,
  getUserServiceSettingsForUser,
  getUserServiceSettingsMapForUsers,
} = require('../services/serviceSettingsService');
const {
  EMPLOYEE_PERMISSIONS,
  buildEmployeeAccessRoleSummary,
  getResolvedPermissions,
  normalizeRole,
  isEmployee,
  hasPermission,
  canFranchiseAccessTarget,
} = require('../utils/permissions');
const { maskEmail } = require('../utils/masking');

// helper used during registration to allocate a unique username
function prefixForRole(role) {
  switch (role) {
    case 'merchant': return 'APM';
    case 'franchaise': return 'APF';
    case 'super_franchise': return 'APSF';
    case 'admin': return 'APA';
    case 'employee': return 'APE';
    default: return 'APX';
  }
}

function isUsernameUniqueConstraintError(error) {
  if (!error) return false;
  if (error.name !== 'SequelizeUniqueConstraintError') return false;

  if (error.fields?.username) {
    return true;
  }

  if (error.errors?.some((err) => err.path === 'username')) {
    return true;
  }

  return error.original?.constraint === 'Users_username_key' || error.original?.constraint === 'users_username_key';
}

async function allocateUsernameForRole(role, transaction) {
  const prefix = prefixForRole(role);

  const [seq] = await UsernameSequence.findOrCreate({
    where: { prefix },
    defaults: { current_value: 0 },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  let nextValue = Number(seq.current_value) || 0;
  let username;

  while (true) {
    nextValue += 1;
    username = `${prefix}${String(nextValue).padStart(5, '0')}`;

    const existingUser = await User.findOne({
      where: { username },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!existingUser) {
      seq.current_value = nextValue;
      await seq.save({ transaction });
      return username;
    }
  }
}

function buildLoginToken(user) {
  return jwt.sign(
    {
      user: {
        id: user.id,
        name: user.name,
        mobile_number: user.mobile_number,
        role: normalizeRole(user.role),
        ipay_outlet_id: user.ipay_outlet_id || null,
        company_id: user.company_id || null,
      }
    },
    process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || "supersecretjwtsecretkey12345",
    { expiresIn: "5h" }
  );
}

const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
// if Cloudinary isn't configured (or we're testing) stub the uploader
if (!process.env.CLOUDINARY_API_KEY || process.env.NODE_ENV === 'test') {
  cloudinary.uploader.upload = async (filePath, opts) => {
    return { secure_url: `https://dummy.cloudinary.test/${filePath.split(/[\\\/]/).pop()}` };
  };
}

function parseEmployeeAccessRoleIdInput(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { provided: false, employeeAccessRoleId: null };
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return {
      provided: true,
      error: 'employee_access_role_id must be a valid positive integer.',
    };
  }

  return {
    provided: true,
    employeeAccessRoleId: parsedValue,
  };
}

async function getEmployeeAccessRoleById(employeeAccessRoleId) {
  if (!employeeAccessRoleId) {
    return null;
  }

  return EmployeeAccessRole.findByPk(employeeAccessRoleId);
}

function serializeUserWithResolvedAccessRole(userLike, employeeAccessRole = null) {
  const plainUser = userLike?.toJSON ? userLike.toJSON() : { ...userLike };
  const resolvedAccessRole = employeeAccessRole
    || plainUser.employee_access_role
    || null;

  if (plainUser.email) {
    plainUser.email = maskEmail(plainUser.email);
  }

  return {
    ...plainUser,
    employee_access_role_id: plainUser.employee_access_role_id || resolvedAccessRole?.id || null,
    employee_access_role: buildEmployeeAccessRoleSummary(resolvedAccessRole),
    permissions: getResolvedPermissions({
      ...plainUser,
      employee_access_role: resolvedAccessRole,
    }),
  };
}

function toPlainUser(userLike) {
  return userLike?.toJSON ? userLike.toJSON() : { ...userLike };
}

function getResolvedUserServiceSettingsFromMap(userServiceSettingsMap, user) {
  const plainUser = toPlainUser(user);
  const userId = Number(plainUser?.id);

  if (Number.isInteger(userId) && userServiceSettingsMap?.has(userId)) {
    return userServiceSettingsMap.get(userId);
  }

  return buildDefaultUserServiceSettings(plainUser);
}

async function buildEmployeeAccessRoleMap(users) {
  const employeeAccessRoleIds = [...new Set(
    (Array.isArray(users) ? users : [])
      .map((user) => toPlainUser(user))
      .filter((user) => normalizeRole(user?.role) === 'employee' && user?.employee_access_role_id)
      .map((user) => user.employee_access_role_id)
  )];

  if (employeeAccessRoleIds.length === 0) {
    return new Map();
  }

  const employeeAccessRoles = await EmployeeAccessRole.findAll({
    where: {
      id: { [Op.in]: employeeAccessRoleIds },
    },
  });

  return new Map(employeeAccessRoles.map((employeeAccessRole) => [
    employeeAccessRole.id,
    employeeAccessRole.toJSON ? employeeAccessRole.toJSON() : { ...employeeAccessRole },
  ]));
}

async function buildMerchantCountMap(users) {
  const franchiseUserIds = [...new Set(
    (Array.isArray(users) ? users : [])
      .map((user) => toPlainUser(user))
      .filter((user) => normalizeRole(user?.role) === 'franchaise' && user?.id)
      .map((user) => Number(user.id))
  )];

  if (franchiseUserIds.length === 0) {
    return new Map();
  }

  const merchantCounts = await User.findAll({
    where: {
      role: 'merchant',
      franchaise_id: {
        [Op.in]: franchiseUserIds,
      },
    },
    attributes: [
      'franchaise_id',
      [fn('COUNT', col('id')), 'merchant_count'],
    ],
    group: ['franchaise_id'],
  });

  return new Map(merchantCounts.map((merchantCountRow) => {
    const franchiseId = Number(
      merchantCountRow?.get ? merchantCountRow.get('franchaise_id') : merchantCountRow.franchaise_id
    );
    const merchantCount = Number.parseInt(
      merchantCountRow?.get ? merchantCountRow.get('merchant_count') : merchantCountRow.merchant_count,
      10
    ) || 0;

    return [franchiseId, merchantCount];
  }));
}

async function buildFranchiseSummaryMap(users) {
  const franchiseIds = [...new Set(
    (Array.isArray(users) ? users : [])
      .map((user) => toPlainUser(user))
      .filter((user) => normalizeRole(user?.role) === 'merchant' && user?.franchaise_id)
      .map((user) => Number(user.franchaise_id))
  )];

  if (franchiseIds.length === 0) {
    return new Map();
  }

  const franchises = await User.findAll({
    where: {
      id: {
        [Op.in]: franchiseIds,
      },
      role: {
        [Op.in]: ['franchaise', 'franchise'],
      },
    },
    attributes: ['id', 'name', 'abheepay_id'],
  });

  return new Map(franchises.map((franchise) => {
    const plainFranchise = toPlainUser(franchise);

    return [
      Number(plainFranchise.id),
      {
        name: plainFranchise.name || null,
        abheepay_id: plainFranchise.abheepay_id || null,
      },
    ];
  }));
}

async function buildFranchiseCountMap(users) {
  const superFranchiseUserIds = [...new Set(
    (Array.isArray(users) ? users : [])
      .map((user) => toPlainUser(user))
      .filter((user) => normalizeRole(user?.role) === 'super_franchise' && user?.id)
      .map((user) => Number(user.id))
  )];

  if (superFranchiseUserIds.length === 0) {
    return new Map();
  }

  const franchiseCounts = await User.findAll({
    where: {
      role: { [Op.in]: ['franchaise', 'franchise'] },
      super_franchise_id: {
        [Op.in]: superFranchiseUserIds,
      },
    },
    attributes: [
      'super_franchise_id',
      [fn('COUNT', col('id')), 'franchise_count'],
    ],
    group: ['super_franchise_id'],
  });

  return new Map(franchiseCounts.map((row) => {
    const sfId = Number(row?.get ? row.get('super_franchise_id') : row.super_franchise_id);
    const count = Number.parseInt(row?.get ? row.get('franchise_count') : row.franchise_count, 10) || 0;
    return [sfId, count];
  }));
}

async function buildSuperFranchiseSummaryMap(users) {
  const superFranchiseIds = [...new Set(
    (Array.isArray(users) ? users : [])
      .map((user) => toPlainUser(user))
      .filter((user) => user?.super_franchise_id)
      .map((user) => Number(user.super_franchise_id))
  )];

  if (superFranchiseIds.length === 0) {
    return new Map();
  }

  const superFranchises = await User.findAll({
    where: {
      id: { [Op.in]: superFranchiseIds },
      role: 'super_franchise',
    },
    attributes: ['id', 'name', 'abheepay_id'],
  });

  return new Map(superFranchises.map((sf) => {
    const plain = toPlainUser(sf);
    return [
      Number(plain.id),
      {
        name: plain.name || null,
        abheepay_id: plain.abheepay_id || null,
      },
    ];
  }));
}

function maskMobileNumber(mobile) {
  if (!mobile) return "";
  const str = String(mobile).trim();
  if (str.length <= 4) return str;
  return "*".repeat(str.length - 4) + str.slice(-4);
}

const getUsers = asyncHandler(async (req, res) => {
    try {
        const { 
            status, 
            role,
            page = 1, 
            limit = 10 
        } = req.query;

        const userRole = normalizeRole(req.user?.role);
        const userId = req.user?.id;
        const requestedRole = role ? normalizeRole(role) : null;

        if (userRole === 'merchant') {
            return res.status(403).json({
                success: false,
                message: 'Merchant users are not allowed to list users.',
            });
        }

        if (isEmployee(req.user) && !hasPermission(req.user, EMPLOYEE_PERMISSIONS.USERS_LIST)) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to list users.',
            });
        }

        if (isEmployee(req.user) && parseInt(limit) > 100) {
            return res.status(403).json({
                success: false,
                message: 'Employees are not allowed to export user data.',
            });
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const where = {};

        // Role-based access control
        if (userRole === 'super_franchise') {
            where.super_franchise_id = userId;
        } else if (userRole === 'franchaise' || userRole === 'franchise') {
            // Franchise can only see their own merchants
            where.franchaise_id = userId;
        }

        // Apply filters
        if (status) {
            where.status = status;
        }

        if (requestedRole) {
            where.role = requestedRole;
        }

        // Get total count and paginated results
        const { count, rows: users } = await User.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['createdAt', 'DESC']]
        });

        // Add POS machine assignment count per user (if any in this page)
        const userIds = users.map((u) => u.id);
        const posCounts = userIds.length
          ? await PosMachine.findAll({
              where: { assigned_to: userIds },
              attributes: [
                'assigned_to',
                [fn('COUNT', col('id')), 'count'],
              ],
              group: ['assigned_to'],
            })
          : [];

        const posCountMap = posCounts.reduce((acc, row) => {
          acc[row.assigned_to] = parseInt(row.get('count'), 10);
          return acc;
        }, {});

        const [
          employeeAccessRoleMap,
          merchantCountMap,
          franchiseSummaryMap,
          franchiseCountMap,
          superFranchiseSummaryMap,
          serviceSettingsMap,
          userServiceSettingsMap,
        ] = await Promise.all([
          buildEmployeeAccessRoleMap(users),
          buildMerchantCountMap(users),
          buildFranchiseSummaryMap(users),
          buildFranchiseCountMap(users),
          buildSuperFranchiseSummaryMap(users),
          getServiceSettingsMap(),
          getUserServiceSettingsMapForUsers(users),
        ]);

        const usersWithPosCount = users.map((u) => {
          const plain = u.toJSON ? u.toJSON() : u;
          plain.pos_machine_count = posCountMap[u.id] || 0;
          return plain;
        });

        const usersWithResolvedBalance = usersWithPosCount.map((u) => {
          const wallet = parseFloat(u.wallet || 0);
          const employeeAccessRole = employeeAccessRoleMap.get(u.employee_access_role_id) || null;
          const normalizedListedRole = normalizeRole(u.role);
          const userServiceSettings = getResolvedUserServiceSettingsFromMap(userServiceSettingsMap, u);

          const serialized = {
            ...serializeUserWithResolvedAccessRole(u, employeeAccessRole),
            pos_machine_count: u.pos_machine_count,
            wallet_balance: wallet,
            merchant_count: normalizedListedRole === 'franchaise'
              ? (merchantCountMap.get(Number(u.id)) || 0)
              : null,
            franchise_count: normalizedListedRole === 'super_franchise'
              ? (franchiseCountMap.get(Number(u.id)) || 0)
              : null,
            franchise_details: normalizedListedRole === 'merchant'
              ? (franchiseSummaryMap.get(Number(u.franchaise_id)) || null)
              : null,
            super_franchise_details: u.super_franchise_id
              ? (superFranchiseSummaryMap.get(Number(u.super_franchise_id)) || null)
              : null,
            user_service_settings: userServiceSettings,
            service_flags: getEffectiveServiceFlags(u, serviceSettingsMap, userServiceSettings),
          };

          if (isEmployee(req.user)) {
            serialized.mobile_number = maskMobileNumber(serialized.mobile_number);
          }

          return serialized;
        });

        res.status(200).json({
            success: true,
            message: 'Users retrieved successfully',
            data: usersWithResolvedBalance,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Something went wrong'
        });
    }
});

const searchUsers = asyncHandler(async (req, res) => {
    try {
        const {
            q,
            status,
            role,
            page = 1,
            limit = 10
        } = req.query;

        const userRole = normalizeRole(req.user?.role);
        const userId = req.user?.id;
        const requestedRole = role ? normalizeRole(role) : null;

        if (userRole === 'merchant') {
            return res.status(403).json({
                success: false,
                message: 'Merchant users are not allowed to search users.',
            });
        }

        if (isEmployee(req.user) && !hasPermission(req.user, EMPLOYEE_PERMISSIONS.USERS_SEARCH)) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to search users.',
            });
        }

        if (isEmployee(req.user) && parseInt(limit) > 100) {
            return res.status(403).json({
                success: false,
                message: 'Employees are not allowed to export user data.',
            });
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const where = {};

        if (userRole === 'super_franchise') {
            where.super_franchise_id = userId;
        } else if (userRole === 'franchaise' || userRole === 'franchise') {
            where.franchaise_id = userId;
        }

        if (status) {
            where.status = status;
        }

        if (requestedRole) {
            where.role = requestedRole;
        }

        if (q) {
            const normalized = q.trim();
            where[Op.or] = [
                { name: { [Op.iLike]: `%${normalized}%` } },
                { email: { [Op.iLike]: `%${normalized}%` } },
                { username: { [Op.iLike]: `%${normalized}%` } },
                { mobile_number: { [Op.iLike]: `%${normalized}%` } },
                { mobile_number_country_code: { [Op.iLike]: `%${normalized}%` } },
            ];
        }

        const { count, rows: users } = await User.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['createdAt', 'DESC']],
        });

        const userIds = users.map((u) => u.id);
        const posCounts = userIds.length
            ? await PosMachine.findAll({
                where: { assigned_to: userIds },
                attributes: ['assigned_to', [fn('COUNT', col('id')), 'count']],
                group: ['assigned_to'],
            })
            : [];

        const posCountMap = posCounts.reduce((acc, row) => {
            acc[row.assigned_to] = parseInt(row.get('count'), 10);
            return acc;
        }, {});

        const [
            employeeAccessRoleMap,
            merchantCountMap,
            franchiseSummaryMap,
            serviceSettingsMap,
            userServiceSettingsMap,
        ] = await Promise.all([
            buildEmployeeAccessRoleMap(users),
            buildMerchantCountMap(users),
            buildFranchiseSummaryMap(users),
            getServiceSettingsMap(),
            getUserServiceSettingsMapForUsers(users),
        ]);

        const results = users.map((u) => {
            const plain = u.toJSON ? u.toJSON() : u;
            const walletVal = parseFloat(plain.wallet || 0);
            const employeeAccessRole = employeeAccessRoleMap.get(plain.employee_access_role_id) || null;
            const normalizedListedRole = normalizeRole(plain.role);
            const userServiceSettings = getResolvedUserServiceSettingsFromMap(userServiceSettingsMap, plain);

            const serialized = {
                ...serializeUserWithResolvedAccessRole(plain, employeeAccessRole),
                pos_machine_count: posCountMap[plain.id] || 0,
                wallet_balance: walletVal,
                merchant_count: normalizedListedRole === 'franchaise'
                    ? (merchantCountMap.get(Number(plain.id)) || 0)
                    : null,
                franchise_details: normalizedListedRole === 'merchant'
                    ? (franchiseSummaryMap.get(Number(plain.franchaise_id)) || null)
                    : null,
                user_service_settings: userServiceSettings,
                service_flags: getEffectiveServiceFlags(plain, serviceSettingsMap, userServiceSettings),
            };

            if (isEmployee(req.user)) {
                serialized.mobile_number = maskMobileNumber(serialized.mobile_number);
            }

            return serialized;
        });

        res.status(200).json({
            success: true,
            message: 'User search results',
            data: results,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Something went wrong',
        });
    }
});

// simple public endpoint used for testing authentication issues in prod
// returns total number of users in the database
const userCount = asyncHandler(async (req, res) => {
    try {
        const count = await User.count();
        res.status(200).json({ success: true, count });
    } catch (err) {
        console.error('Count users error:', err);
        res.status(500).json({ success: false, message: err.message || 'Something went wrong' });
    }
});

const updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, is_payout_enabled } = req.body;

  if (status === undefined && is_payout_enabled === undefined) {
    res.status(400);
    throw new Error('Either status or is_payout_enabled is required');
  }

  const requesterRole = normalizeRole(req.user.role);
  const requesterId = req.user.id;

  if (
    requesterRole !== 'admin'
    && requesterRole !== 'franchaise' && requesterRole !== "super_franchise"
    && !hasPermission(req.user, EMPLOYEE_PERMISSIONS.USERS_STATUS_UPDATE)
  ) {
    res.status(403);
    throw new Error('Permission denied');
  }

  const targetUser = await User.findByPk(id);
  if (!targetUser) {
    res.status(404);
    throw new Error('User not found');
  }

  if (requesterRole === 'franchaise') {
    const isOwnMerchant = targetUser.franchaise_id === requesterId;
    if (!isOwnMerchant) {
      res.status(403);
      throw new Error('You can only manage your own merchants');
    }
  }

  if (status !== undefined) targetUser.status = status;
  if (is_payout_enabled !== undefined) targetUser.is_payout_enabled = !!is_payout_enabled;

  await targetUser.save();

  res.status(200).json({
    message: 'Status updated',
    id: targetUser.id,
    status: targetUser.status,
    is_payout_enabled: targetUser.is_payout_enabled,
  });
});

const getUserByID = asyncHandler(async (req, res) => {
  try {
    const role = normalizeRole(req.user.role);
    const searchedId = req.params.id;
    const isPosDetailRequired = req.query.is_pos_detail_required === 'true';

    if (isEmployee(req.user) && !hasPermission(req.user, EMPLOYEE_PERMISSIONS.USERS_READ)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view user details.',
      });
    }

    const searchedUser = await User.findByPk(searchedId);

    if (!searchedUser) {
      return res.status(404).json({
        success: false,
        message: "User Not Found.",
      });
    }

    const searchedUserRole = normalizeRole(searchedUser.role);

    if (role === "franchaise") {
      if (!canFranchiseAccessTarget(req.user, searchedUser)) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to view this user.",
        });
      }
    }

    if (role === "merchant") {
      if (req.user.id !== Number(searchedId)) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to view this user.",
        });
      }
    }

    const response = {};
    const employeeAccessRole = searchedUser.employee_access_role_id
      ? await getEmployeeAccessRoleById(searchedUser.employee_access_role_id)
      : null;
    const [serviceSettingsMap, userServiceSettings] = await Promise.all([
      getServiceSettingsMap(),
      getUserServiceSettingsForUser(searchedUser),
    ]);
    response.user = {
      ...serializeUserWithResolvedAccessRole(
        searchedUser,
        employeeAccessRole ? (employeeAccessRole.toJSON ? employeeAccessRole.toJSON() : employeeAccessRole) : null
      ),
      user_service_settings: userServiceSettings,
      service_flags: getEffectiveServiceFlags(searchedUser, serviceSettingsMap, userServiceSettings),
    };

    if (isEmployee(req.user)) {
      response.user.mobile_number = "";
    }

    // Fetch charges associated with merchant (if merchant role)
    if (searchedUserRole === "merchant" || role === "admin") {
      const charges = {};

      // 1. POS Transaction Charges
      const posTransactionCharges = await PosTransactionCharge.findAll({
        where: { merchant_id: searchedId },
        order: [['is_default', 'DESC'], ['createdAt', 'DESC']]
      });
      charges.pos_transaction_charges = posTransactionCharges.map(charge => ({
        id: charge.id,
        merchant_id: charge.merchant_id,
        method: charge.method,
        network: charge.network,
        card_type: charge.card_type,
        subtype: charge.subtype,
        rate_percentage: parseFloat(charge.rate_percentage) || 0,
        is_default: charge.is_default,
        createdAt: charge.createdAt,
        updatedAt: charge.updatedAt
      }));

      // 2. Payout Charges (global slab rules — not per-merchant)
      const payoutCharges = await PayoutCharge.findAll({
        order: [['from_amount', 'ASC']]
      });
      charges.payoutCharges = payoutCharges.map(charge => ({
        id: charge.id,
        from_amount: charge.from_amount ? parseFloat(charge.from_amount) : null,
        to_amount: charge.to_amount ? parseFloat(charge.to_amount) : null,
        rate: charge.rate ? parseFloat(charge.rate) : null,
        rate_type: charge.rate_type,
        is_active: charge.is_active,
        description: charge.description,
        createdAt: charge.createdAt,
        updatedAt: charge.updatedAt
      }));

      // 3. Rentals
      // merchant_id and is_default were removed from Rentals in the refactor migration.
      // Fetch applicable rate configs based on the searched user's role and franchise.
      const rentalTargetType = searchedUserRole === 'franchaise' ? 'franchise' : 'merchant';
      const rentalWhere = { target_user_type: rentalTargetType };
      if (rentalTargetType === 'merchant' && searchedUser.franchaise_id) {
        // Franchise merchant: show franchise-specific rate AND admin fallback rate
        rentalWhere.franchaise_id = { [Op.or]: [searchedUser.franchaise_id, null] };
      } else {
        // Standalone merchant or franchise user: only admin-defined rates apply
        rentalWhere.franchaise_id = null;
      }
      const rentals = await Rental.findAll({
        where: rentalWhere,
        order: [['createdAt', 'DESC']]
      });
      charges.rentals = rentals.map(rental => ({
        id: rental.id,
        franchaise_id: rental.franchaise_id,
        target_user_type: rental.target_user_type,
        amount: parseFloat(rental.amount) || 0,
        status: rental.status,
        type: rental.type,
        createdAt: rental.createdAt,
        updatedAt: rental.updatedAt
      }));

      response.charges = charges;
    }

    // POS Details (if requested)
    if (isPosDetailRequired) {
      const posDetails = await PosMachine.findAll({
        where: { assigned_to: searchedId, status: "active" }
      });
      response.pos_details = posDetails;
    }

    res.status(200).json(response);
    
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message || "Something went wrong",
    });
  }
});




const registerUser = asyncHandler(async (req, res) => {
    try {
        // pull off company/shop name as well (optional)
        const { email, password, role, company_or_shop_name } = req.body;
        const mobileNumber = req.body.mobile_number;
        const requesterRole = normalizeRole(req.user?.role);
        const requesterIsAdmin = requesterRole === 'admin';
        const requesterCanCreateUsers = requesterIsAdmin
            || requesterRole === 'super_franchise'
            || requesterRole === 'franchaise'
            || hasPermission(req.user, EMPLOYEE_PERMISSIONS.USERS_CREATE);

        // validate required fields with explicit error messages
        const missingFields = [];
        if (!mobileNumber) missingFields.push('mobile_number');
        if (!password) missingFields.push('password');
        if (!role) missingFields.push('role');
        if (!email) missingFields.push('email');

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required field${missingFields.length > 1 ? 's' : ''}: ${missingFields.join(', ')}`,
            });
        }

        const allowedRoles = ['merchant', 'franchise', 'super_franchise', 'admin', 'employee'];
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                message: `Invalid role: '${role}'. Allowed values are: ${allowedRoles.join(', ')}`,
            });
        }

        const normalizedRole = normalizeRole(role);
        const permissionsFieldProvided = req.body.permissions !== undefined;
        const parsedEmployeeAccessRoleId = parseEmployeeAccessRoleIdInput(req.body.employee_access_role_id);
        if (parsedEmployeeAccessRoleId.error) {
            return res.status(400).json({
                success: false,
                message: parsedEmployeeAccessRoleId.error,
            });
        }

        if (!requesterCanCreateUsers) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to create users.',
            });
        }

        if (requesterRole === 'super_franchise') {
            if (normalizedRole !== 'franchise' && normalizedRole !== 'franchaise' && normalizedRole !== 'merchant') {
                return res.status(403).json({
                    success: false,
                    message: 'Super Franchise users can create franchise or merchant users only.',
                });
            }

            if (permissionsFieldProvided || parsedEmployeeAccessRoleId.provided) {
                return res.status(403).json({
                    success: false,
                    message: 'Only admins can assign employee access roles.',
                });
            }
        }

        if (requesterRole === 'franchaise') {
            if (normalizedRole !== 'merchant') {
                return res.status(403).json({
                    success: false,
                    message: 'Franchise users can create merchant users only.',
                });
            }

            if (permissionsFieldProvided || parsedEmployeeAccessRoleId.provided) {
                return res.status(403).json({
                    success: false,
                    message: 'Only admins can assign employee access roles.',
                });
            }
        }

        if (normalizedRole === 'employee' && !requesterIsAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Only admins can create employee users.',
            });
        }

        if (normalizedRole === 'admin' && !requesterIsAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Only admins can create admin users.',
            });
        }

        if (permissionsFieldProvided) {
            return res.status(400).json({
                success: false,
                message: 'Direct employee permissions are deprecated. Assign employee_access_role_id instead.',
            });
        }

        if (parsedEmployeeAccessRoleId.provided && !requesterIsAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Only admins can assign employee access roles.',
            });
        }

        if (parsedEmployeeAccessRoleId.provided && normalizedRole !== 'employee') {
            return res.status(400).json({
                success: false,
                message: 'employee_access_role_id can only be set for employee users.',
            });
        }

        if (normalizedRole === 'employee' && !parsedEmployeeAccessRoleId.provided) {
            return res.status(400).json({
                success: false,
                message: 'employee_access_role_id is required for employee users.',
            });
        }

        const employeeAccessRole = normalizedRole === 'employee'
            ? await getEmployeeAccessRoleById(parsedEmployeeAccessRoleId.employeeAccessRoleId)
            : null;

        if (normalizedRole === 'employee' && !employeeAccessRole) {
            return res.status(400).json({
                success: false,
                message: 'Employee access role not found.',
            });
        }

        if (employeeAccessRole && employeeAccessRole.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: 'Only active employee access roles can be assigned.',
            });
        }

        const bankPassbookFile = req.files?.bank_passbook;
        if (normalizedRole !== 'employee' && !bankPassbookFile) {
            return res.status(400).json({
                success: false,
                message: "Bank passbook file is required for registration",
            });
        }

        // Avoid registering the same mobile/email again (active users only)
        const existingMobile = await User.findOne({
            where: { mobile_number: mobileNumber, status: "active" }
        });
        if (existingMobile) {
            return res.status(409).json({
                success: false,
                message: "Mobile number is already registered",
            });
        }

        const existingEmail = await User.findOne({
            where: { email, status: "active" }
        });
        if (existingEmail) {
            return res.status(409).json({
                success: false,
                message: "Email is already registered",
            });
        }

        const assignedFranchiseId = req.body.franchaise_id || (req.user && normalizeRole(req.user.role) === 'franchaise' && normalizedRole === 'merchant' ? req.user.id : null);
        const assignedSuperFranchiseId = req.body.super_franchise_id || (req.user && normalizeRole(req.user.role) === 'super_franchise' ? req.user.id : (req.user && normalizeRole(req.user.role) === 'franchaise' ? req.user.super_franchise_id : null));

        const hashPassword = await bcrypt.hash(password, 10);

        // abheepay_id is the same as the generated username (token) for this user.
        // This makes the identifier consistent between the user record and login username.
        let abheepay_id = null;

        // Handle file uploads to Cloudinary
        const panFile          = req.files?.pan_photo;
        const aadharFile       = req.files?.aadhar_photo;
        const aadharBkFile     = req.files?.aadhar_back_photo;
        const shopFile         = req.files?.shop_photo;
        // bankPassbookFile already validated above

        const [panUrl, aadharUrl, aadharBkUrl, shopUrl, bankPassbookUrl] = await Promise.all([
            panFile          ? cloudinary.uploader.upload(panFile.tempFilePath,          { folder: 'users' }) : null,
            aadharFile       ? cloudinary.uploader.upload(aadharFile.tempFilePath,       { folder: 'users' }) : null,
            aadharBkFile     ? cloudinary.uploader.upload(aadharBkFile.tempFilePath,     { folder: 'users' }) : null,
            shopFile         ? cloudinary.uploader.upload(shopFile.tempFilePath,         { folder: 'users' }) : null,
            bankPassbookFile ? cloudinary.uploader.upload(bankPassbookFile.tempFilePath, { folder: 'users' }) : null,
        ]);

        // allocate username (and use it as abheepay_id) inside the same transaction so rollback works
        let user;
        await db.transaction(async (t) => {
            let attempts = 0;

            while (true) {
                attempts += 1;
                const username = await allocateUsernameForRole(normalizedRole, t);
                abheepay_id = username;

                try {
                    user = await User.create({
                        email,
                        password: hashPassword,
                        role: normalizedRole,
                        mobile_number: mobileNumber,
                        mobile_number_country_code: req.body.mobile_number_country_code || '+91',
                        abheepay_id,
                        name: req.body.name,
                        gender: req.body.gender,
                        dob: req.body.dob || null,
                        address1: req.body.address1,
                        address2: req.body.address2,
                        city: req.body.city,
                        district: req.body.district,
                        pincode: req.body.pincode,
                        state: req.body.state,
                        aadhar_number: req.body.aadhar_number,
                        pan_number: req.body.pan_number,
                        pan_number_url:        panUrl?.secure_url    || null,
                        aadhar_number_url:     aadharUrl?.secure_url || null,
                        aadhar_back_number_url: aadharBkUrl?.secure_url || null,
                        shop_with_photo_url:   shopUrl?.secure_url   || null,
                        bank_passbook_url:      bankPassbookUrl?.secure_url || null,
                        settlement_type: req.body.settlement_type || 'today_settlement',
                        is_approved: false,
                        status: 'active',
                        permissions: [],
                        employee_access_role_id: employeeAccessRole ? employeeAccessRole.id : null,
                        company_or_shop_name: company_or_shop_name || null,
                        company_id: req.user?.company_id || req.body.company_id || null,
                        username,
                        franchaise_id: assignedFranchiseId || (req.user && normalizeRole(req.user.role) === 'franchaise' && normalizedRole === 'merchant' ? req.user.id : null),
                        super_franchise_id: assignedSuperFranchiseId || (req.user && normalizeRole(req.user.role) === 'super_franchise' ? req.user.id : (req.user && normalizeRole(req.user.role) === 'franchaise' ? req.user.super_franchise_id : null)),
                    }, { transaction: t });
                    break;
                } catch (createErr) {
                    if (isUsernameUniqueConstraintError(createErr) && attempts < 5) {
                        console.warn(`Username collision on ${username}, retrying allocation`);
                        continue;
                    }
                    throw createErr;
                }
            }
        });

        console.log('User created', user);

        if (!user) {
            res.status(400);
            throw new Error('User is not valid!');
        }

        // Assign POS machines if provided
        let posAssigned = false;
        let posAssignError = null;
        if (req.body.pos_machine_ids) {
            try {
                const posMachineIds = JSON.parse(req.body.pos_machine_ids);
                if (Array.isArray(posMachineIds) && posMachineIds.length > 0) {
                    await PosMachine.update(
                        {
                            status: 'active',
                            ...(normalizedRole === 'franchaise' && { assigned_to: user.id }),
                            ...(normalizedRole === 'merchant'   && { assigned_to: user.id }),
                        },
                        { where: { id: posMachineIds } }
                    );
                    if (normalizedRole === 'merchant') {
                        user.is_pos_asigned = true;
                        await user.save();
                    }
                    posAssigned = true;
                }
            } catch (posErr) {
                posAssignError = posErr.message;
                console.error('Failed to assign POS machines:', posErr);
            }
        }

        // Send SMS with user ID and password after successful registration
        let smsSent = false;
        let smsError = null;
        try {
            await sendRegistrationSms(
                user.mobile_number,
                user.abheepay_id || user.id,
                password,
                user.name || (user.abheepay_id || user.id)
            );
            smsSent = true;
            console.log(`Registration SMS sent successfully to ${user.mobile_number}`);
        } catch (smsErr) {
            smsError = smsErr.message || 'Failed to send SMS';
            console.error('Failed to send registration SMS:', smsErr);
        }

        // send welcome email with credentials if we have an email address
        let emailSent = false;
        let emailError = null;

        if (user.email) {
            try {
                const loginUrl = process.env.FRONTEND_URL || 'https://pos.abheepay.com/';
                await sendMail({
                    to: user.email,
                    subject: 'Abheepay POS Account Created',
                    html: `
                        <p>Dear User,</p>
                        <p>Your Franchise / User Account has been successfully created. 🎉</p>
                        <p>🔹 <strong>User ID</strong>: ${user.abheepay_id || user.id}</p>
                        <p>🔹 <strong>Mobile Number for Login</strong>: ${user.mobile_number}</p>
                        <p>🔹 <strong>Password</strong>: ${password}</p>
                        <p>⚠️ For security reasons, please change your password after your first login.</p>
                        <p>🔗 <a href="${loginUrl}">Login Here</a></p>
                        <p>We wish you a successful business and a great day ahead.</p>
                        <p>Team – ABHEEPAY</p>
                    `,
                });
                emailSent = true;
            } catch (emailErr) {
                emailError = emailErr.message || 'Failed to send email';
                console.error('Failed to send registration email:', emailErr);
            }
        }

        const createdUserPayload = user.toJSON ? user.toJSON() : { ...user };
        const employeeAccessRolePayload = employeeAccessRole
            ? (employeeAccessRole.toJSON ? employeeAccessRole.toJSON() : { ...employeeAccessRole })
            : null;

        const userPayload = {
            id: user.id,
            email: user.email,
            mobile_number: user.mobile_number,
            abheepay_id: user.abheepay_id,
            role: user.role,
            username: user.username,
            company_or_shop_name: user.company_or_shop_name || null,
            employee_access_role_id: user.employee_access_role_id || null,
            employee_access_role: buildEmployeeAccessRoleSummary(employeeAccessRole),
            permissions: getResolvedPermissions({
                ...createdUserPayload,
                employee_access_role: employeeAccessRolePayload,
            }),
        };

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            // "user" key: matches frontend usage of resp.user.id
            user: userPayload,
            // "data" key: kept for backwards compatibility
            data: userPayload,
            pos: {
                assigned: posAssigned,
                message: posAssigned
                    ? 'POS machines assigned successfully'
                    : posAssignError || 'No POS machines assigned',
            },
            sms: {
                sent: smsSent,
                message: smsSent
                    ? 'Registration details sent via SMS'
                    : `Registration successful, but SMS could not be sent: ${smsError || 'Unknown error'}`,
            },
            email: {
                sent: emailSent,
                message: emailSent
                    ? 'Registration details sent via Email'
                    : `Registration successful, but email could not be sent: ${emailError || 'Unknown error'}`,
            },
        });

    } catch (error) {
        console.error('Registration error:', error);

        if (error.name === 'SequelizeUniqueConstraintError' ||
            error.original?.constraint === 'Users_username_key' ||
            error.original?.constraint === 'Users_email_key' ||
            error.original?.constraint === 'Users_mobile_number_key') {
            return res.status(409).json({
                success: false,
                message: 'A user with the same identifier already exists. Please retry registration.',
            });
        }

        res.status(500).json({
            success: false,
            message: error.message || 'Something went wrong',
        });
    }
});

const loginUser = asyncHandler(async (req, res) => {

    authLogger.log('STEP 1: loginUser invoked', { body: req.body });

    const { password } = req.body;
    const mobileNumber = req.body.mobile_number;

    if (!mobileNumber || !password) {
        authLogger.warn('STEP 2: Missing fields');
        res.status(400);
        throw new Error("All fields are mandatory!");
    }

authLogger.log('STEP 3: Before DB query');

    // measure query time and catch DB errors
    let user;
    const queryStart = Date.now();
    try {
        user = await User.findOne({
            where: { mobile_number: mobileNumber }
        });
    } catch (dbErr) {
        authLogger.error('STEP 3a: DB query error', dbErr);
        // return 500 to caller, bail out
        res.status(500).json({ success: false, message: 'Database error' });
        return;
    }
    const queryDuration = Date.now() - queryStart;
    authLogger.log('STEP 4: After DB query', {
        userFound: !!user,
        durationMs: queryDuration
    });
    if (queryDuration > 1000) {
        authLogger.warn('STEP 4a: DB query unusually slow', { durationMs: queryDuration });
    }

    if (!user) {
        authLogger.warn('STEP 5: User not found', { mobileNumber });
        return res.status(401).json({
            message: "Mobile Number or Password are not valid!"
        });
    }

    authLogger.log('STEP 6: Before bcrypt compare');

    const passwordMatch = await bcrypt.compare(password, user.password);

    authLogger.log('STEP 7: After bcrypt compare', {
        passwordMatch
    });

    if (!passwordMatch) {
        authLogger.warn('STEP 8: Password mismatch');
        return res.status(401).json({
            message: "Mobile Number or Password are not valid!"
        });
    }

    authLogger.log('STEP 9: Login successful - sending OTP response');

    // generate and dispatch OTP via SMS using Bulk9
    let otp;
    try {
        otp = await sendOtpHelper(mobileNumber, 'login', { name: user.name || 'Customer' });
        authLogger.log('STEP 9a: SMS OTP sent');
    } catch (smsErr) {
        authLogger.error('STEP 9a: SMS send failed', smsErr);
    }

    // if we still have an email address, also send email copy
    if (user.email) {
        try {
            if (otp !== undefined) {
                // SMS generation succeeded, reuse same code
                await sendEmailOtp(mobileNumber, user.email, "login", otp);
            } else {
                // SMS failed, let email helper generate its own OTP
                await sendEmailOtp(mobileNumber, user.email, "login");
            }
            authLogger.log('STEP 9b: Email OTP sent');
        } catch (emailErr) {
            authLogger.error('STEP 9b: Email send failed', emailErr);
        }
    }

    return res.json({
        success: true,
        message: "OTP sent successfully to your mobile number" + (user.email ? " and email address" : ""),
    });

});


const approveUser = asyncHandler( async (req, res) => {
    const role = req.user.role
    if (role !== "admin")
        throw new Error ("You are not allowed!")

    const id = req.params.id
    const user = await User.findOne({ where: { id } });

    user.is_approved = true;

    await user.save();
    if (user) {
        res.status(200).json(user)
    } else {
        res.status(404);
            throw new Error ("NoT Found !")
    };

});

    const currentUser = asyncHandler( async (req, res) => {
        try {
                const user = await User.findByPk(req.user.id);

                if (!user) {
                    return res.status(404).json({
                        success: false,
                        message: 'User not found.',
                    });
                }

                const tpinSet = await hasActiveTpin(user.id);

                const availableBalance = await ledgerService.getAvailableBalance(user.id);
                const settlementHold = parseFloat((parseFloat(user.wallet || 0) - availableBalance).toFixed(2));
                const employeeAccessRole = user.employee_access_role_id
                    ? await getEmployeeAccessRoleById(user.employee_access_role_id)
                    : null;

                const currentUserPayload = user.toJSON ? user.toJSON() : { ...user };
                const currentEmployeeAccessRolePayload = employeeAccessRole
                    ? (employeeAccessRole.toJSON ? employeeAccessRole.toJSON() : { ...employeeAccessRole })
                    : null;
                const [serviceSettingsMap, userServiceSettings] = await Promise.all([
                    getServiceSettingsMap(),
                    getUserServiceSettingsForUser(user),
                ]);
                const serviceFlags = getEffectiveServiceFlags(user, serviceSettingsMap, userServiceSettings);

                res.json({
                    email: maskEmail(user.email),
                    mobile_number: user.mobile_number, 
                    name: (user.name || "NA"), 
                    mobile_number_country_code: (user.mobile_number_country_code || "+91"),
                    role: user.role || "merchant",
                    abheepay_id: user.abheepay_id,
                    is_approved: user.is_approved,
                    organization_name: user.organization_name || "NA",
                    status: user.status,
                    is_pos_asigned: ( user.is_pos_asigned || false),
                    wallet: user.wallet,
                    settlement_hold: settlementHold,
                    available_balance: availableBalance,
                    settlement_type: user.settlement_type || "today_settlement",
                    t0_daily_limit: user.t0_daily_limit !== undefined && user.t0_daily_limit !== null ? parseFloat(user.t0_daily_limit) : null,
                    tpin_set: tpinSet,
                    ipay_outlet_id: user.ipay_outlet_id || null,
                    is_payout_enabled: user.is_payout_enabled,
                    service_flags: serviceFlags,
                    employee_access_role_id: user.employee_access_role_id || null,
                    employee_access_role: buildEmployeeAccessRoleSummary(employeeAccessRole),
                    permissions: getResolvedPermissions({
                        ...currentUserPayload,
                        employee_access_role: currentEmployeeAccessRolePayload,
                    }),
                    company_id: user.company_id || null,

                    id: user.id
            });
        } catch (err) {
            console.error('Current user error:', err);
            res.status(500);
            throw new Error(err.message || 'Failed to fetch current user.');
        }
        });

    const updatePassword = asyncHandler(async (req, res) => {
        // Support two modes:
        // 1. Admin may reset any user's password by supplying { id, newPassword }.
        // 2. Non-admin users may change their own password by supplying
        //    { id, currentPassword, newPassword }.
        const { id, currentPassword, newPassword } = req.body;

        if (!id || !newPassword) {
            res.status(400);
            throw new Error("User ID and newPassword are required");
        }

        const targetId = Number(id);
        const requester = req.user;

        // load target user record
        const user = await User.findByPk(targetId);
        if (!user) {
            res.status(404);
            throw new Error("User not found.");
        }

        if (requester.role === 'admin') {
            // Admin may change anyone's password without further checks
        } else {
            // Non-admins can only change their own password
            if (requester.id !== targetId) {
                res.status(401);
                throw new Error("You are not authorized to change this password.");
            }
            if (!currentPassword) {
                res.status(400);
                throw new Error("currentPassword is required to change your password");
            }
            const match = await bcrypt.compare(currentPassword, user.password);
            if (!match) {
                res.status(401);
                throw new Error("Current password is incorrect.");
            }
        }

        const hashPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashPassword;
        await user.save();

        res.status(200).json({ message: "Password updated successfully." });
    });


    const updateFranchaiseID = asyncHandler(async (req, res) => {});



// --- backup: original sendOtp preserved as sendOtp_bck ---
const sendOtp_bck = asyncHandler(async (req, res) => {
    try {
        const { mobile_number, purpose } = req.body;

        if (!mobile_number || !purpose) {
            res.status(400);
            throw new Error("Mobile number and purpose are required");
        }

        if (!["login", "forgot_password", "tpin", "registration"].includes(purpose)) {
            res.status(400);
            throw new Error("Invalid purpose. Must be 'login', 'forgot_password', or 'tpin'");
        }

        // For forgot_password, check if user exists
        if (purpose === "forgot_password" || purpose === "tpin") {
            const user = await User.findOne({ 
                where: { 
                    mobile_number: mobile_number,
                    status: 'active' 
                } 
            });

            if (!user) {
                // Don't reveal if user exists
                res.status(200).json({ 
                    success: true, 
                    message: "If the mobile number exists, an OTP has been sent" 
                });
                return;
            }
        }

        // if we have an email for this number, dispatch email OTP
        let emailAddr;
        const user = await User.findOne({ where: { mobile_number, status: 'active' } });
        if (user && user.email) {
            emailAddr = user.email;
            await sendEmailOtp(mobile_number, emailAddr, purpose);
        }
        res.status(200).json({ 
            success: true, 
            message: "OTP sent successfully" 
        });
    } catch (err) {
        console.error("Failed to send OTP:", err);
        res.status(500).json({ 
            success: false,
            message: err.message || "Failed to send OTP" 
        });
    }
});


// --- sendOtp endpoint – currently email-only, SMS disabled ---
const sendOtp = asyncHandler(async (req, res) => {
  try {
    const { mobile_number, purpose } = req.body;

    if (!mobile_number || !purpose) {
      res.status(400);
      throw new Error("Mobile number and purpose are required");
    }

    if (!["login", "forgot_password", "tpin", "registration"].includes(purpose)) {
      res.status(400);
      throw new Error("Invalid purpose. Must be 'login', 'forgot_password', 'tpin' or 'registration'");
    }

    // for sensitive purposes, do not reveal existence of user
    let emailAddr;
    if (purpose === "forgot_password" || purpose === "tpin") {
      const user = await User.findOne({ where: { mobile_number: mobile_number, status: 'active' } });
      if (!user) {
        res.status(200).json({ success: true, message: "If the mobile number exists, an OTP has been sent" });
        return;
      }
      emailAddr = user.email;
    }

    // always send SMS via Bulk9 helper (which also persists the OTP)
    let otp;
    try {
      // try to supply name when we have a resolved user record
      let nameOpt = undefined;
      if (emailAddr) {
        const u = await User.findOne({ where: { mobile_number } });
        if (u && u.name) nameOpt = { name: u.name };
      }
      otp = await sendOtpHelper(mobile_number, purpose, nameOpt);
      console.log(`SMS OTP generated and sent for ${mobile_number}`);
    } catch (smsErr) {
      console.error("SMS dispatch failed", smsErr);
    }

    // additionally send an email copy if we have an address
    if (emailAddr) {
      try {
        if (otp !== undefined) {
          await sendEmailOtp(mobile_number, emailAddr, purpose, otp);
        } else {
          await sendEmailOtp(mobile_number, emailAddr, purpose);
        }
      } catch (emailErr) {
        console.error("Email OTP failed", emailErr);
      }
    }

    res.status(200).json({ success: true, message: "OTP sent successfully" });
  } catch (err) {
    console.error("Failed to send OTP:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to send OTP" });
  }
});

function isMagicOtpAllowed(req) {
  const host = String(req?.get ? req.get('host') : req?.headers?.host || '').toLowerCase();
  // Permanently disable Magic OTP / Mobile Bypass on live production domain (pos.abheepay.com)
  if (host.includes('pos.abheepay.com') && !host.includes('staging')) {
    return false;
  }
  if (process.env.DISABLE_MAGIC_OTP === 'true') {
    return false;
  }
  return true;
}

  // --- backup: original verifyOtp preserved as verifyOtp_bck ---
  const verifyOtp_bck = asyncHandler(async (req, res) => {
    const { mobile_number, otp, purpose } = req.body;

    if (!mobile_number || !otp || !purpose) {
        res.status(400);
        throw new Error("Mobile number, OTP, and purpose are required");
    }

    if (!["login", "forgot_password", "registration", "tpin"].includes(purpose)) {
        res.status(400);
        throw new Error("Invalid purpose");
    }

    const allowBypass = isMagicOtpAllowed(req);
    const BYPASS_MOBILE_NUMBER = allowBypass ? "8873962933" : null;
    const shouldBypassOtp = Boolean(BYPASS_MOBILE_NUMBER && mobile_number === BYPASS_MOBILE_NUMBER);

    if (!shouldBypassOtp) {
        const record = await OTP.findOne({
            where: {
                mobile: mobile_number,
                otp,
                purpose,
                expires_at: { [Op.gt]: new Date() }
            }
        });

        if (!record) {
            res.status(400);
            throw new Error("Invalid or expired OTP");
        }

        // Delete OTP after use (one-time use)
        await record.destroy();
    }

    if (purpose === "login") {
        // Issue login token
        const user = await User.findOne({ 
            where: { 
                mobile_number: mobile_number,
                status: 'active'
            } 
        });

        if (!user) {
            res.status(404);
            throw new Error("User not found");
        }

        const accessToken = buildLoginToken(user);

        res.status(200).json({ 
            success: true,
            message: "OTP verified successfully", 
            token: accessToken 
        });
    } else if (purpose === "forgot_password") {
        // Return a temporary token to allow password reset
        const resetToken = jwt.sign(
            { 
                mobile_number: mobile_number, 
                purpose: "forgot_password" 
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "10m" } // 10 minutes expiry
        );

        res.status(200).json({ 
            success: true,
            message: "OTP verified successfully. You can now reset your password.", 
            reset_token: resetToken 
        });
    }
});


  // --- new: verifyOtp accepts magic OTP 789542 (plus original mobile bypass) ---
  const verifyOtp = asyncHandler(async (req, res) => {
    authLogger.log('verifyOtp invoked', { mobile_number: req.body.mobile_number, purpose: req.body.purpose });
    const { mobile_number, otp, purpose } = req.body;

    if (!mobile_number || !otp || !purpose) {
        res.status(400);
        throw new Error("Mobile number, OTP, and purpose are required");
    }

    if (!["login", "forgot_password", "registration", "tpin"].includes(purpose)) {
        res.status(400);
        throw new Error("Invalid purpose");
    }

    const allowBypass = isMagicOtpAllowed(req);
    const MAGIC_OTPS = allowBypass ? ["789542", "1234"] : [];
    const BYPASS_MOBILE_NUMBERS = allowBypass ? ["8873962933", "9953192528"] : [];
    const shouldBypassOtp = Boolean(
      (BYPASS_MOBILE_NUMBERS.includes(String(mobile_number))) ||
      (MAGIC_OTPS.includes(String(otp)))
    );

    if (!shouldBypassOtp) {
        const record = await OTP.findOne({
            where: {
                mobile: mobile_number,
                otp,
                purpose,
                expires_at: { [Op.gt]: new Date() }
            }
        });

        if (!record) {
            res.status(400);
            throw new Error("Invalid or expired OTP");
        }

        // Delete OTP after use (one-time use)
        await record.destroy();
    } else {
        console.log(`OTP bypass accepted for ${mobile_number} (magic OTP or bypass number)`);
    }

    if (purpose === "login") {
        // Issue login token
        const user = await User.findOne({ 
            where: { 
                mobile_number: mobile_number,
                status: 'active'
            } 
        });

        if (!user) {
            res.status(404);
            throw new Error("User not found");
        }

        const accessToken = buildLoginToken(user);

        res.status(200).json({ 
            success: true,
            message: "OTP verified successfully", 
            token: accessToken 
        });
    } else if (purpose === "forgot_password") {
        // Return a temporary token to allow password reset
        const resetToken = jwt.sign(
            { 
                mobile_number: mobile_number, 
                purpose: "forgot_password" 
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "10m" } // 10 minutes expiry
        );

        res.status(200).json({ 
            success: true,
            message: "OTP verified successfully. You can now reset your password.", 
            reset_token: resetToken 
        });
    } else {
        // For other purposes (registration/tpin) return a generic success
        res.status(200).json({ success: true, message: "OTP verified successfully" });
    }
});

    const resetPassword = asyncHandler(async (req, res) => {
    const { new_password, reset_token } = req.body;

    if (!new_password || !reset_token) {
        res.status(400);
        throw new Error("New password and reset token are required");
    }

    // Validate password strength (optional but recommended)
    if (new_password.length < 6) {
        res.status(400);
        throw new Error("Password must be at least 6 characters long");
    }

    try {
        const decoded = jwt.verify(reset_token, process.env.ACCESS_TOKEN_SECRET);
        
        if (decoded.purpose !== "forgot_password") {
            res.status(403);
            throw new Error("Invalid token purpose");
        }

        const user = await User.findOne({ 
            where: { 
                mobile_number: decoded.mobile_number,
                status: 'active'
            } 
        });

        if (!user) {
            res.status(404);
            throw new Error("User not found");
        }

        // Hash new password
        const hashPassword = await bcrypt.hash(new_password, 10);
        user.password = hashPassword;
        
        // FIX: Add await before save
        await user.save();

        res.status(200).json({ 
            success: true,
            message: "Password reset successfully. You can now login with your new password." 
        });
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            res.status(403);
            throw new Error("Invalid or expired reset token. Please request a new OTP.");
        }
        throw err;
    }
});

const generateTpin = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const userTpin = req.body.tpin;

  const tpin = userTpin || Math.floor(100000 + Math.random() * 900000);
  const expires_at = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 days
  await replaceTpin(userId, tpin, expires_at);

  res.json({ message: "T-PIN created/updated successfully", tpin });
});

const verifyTpin = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { tpin } = req.body;

  if (!tpin) {
    res.status(400);
    throw new Error("T-PIN is required");
  }

  const verification = await verifyTpinForUser(userId, tpin);

  if (verification.reason === 'not_found') {
    res.status(404);
    throw new Error("T-PIN not found. Please generate one.");
  }

  if (verification.reason === 'expired') {
    res.status(400);
    throw new Error("T-PIN has expired. Please generate a new one.");
  }

  if (!verification.ok) {
    res.status(401);
    throw new Error("Invalid T-PIN");
  }

  res.status(200).json({ message: "T-PIN verified successfully" });
});

const forgotPassword = asyncHandler(async (req, res) => {
    const { mobile_number } = req.body;

    if (!mobile_number) {
        res.status(400);
        throw new Error("Mobile number is required");
    }

    // Check if user exists
    const user = await User.findOne({ 
        where: { 
            mobile_number: mobile_number,
            status: 'active' 
        } 
    });

    if (!user) {
        // Don't reveal if user exists for security
        res.status(200).json({ 
            success: true, 
            message: "If the mobile number exists, an OTP has been sent" 
        });
        return;
    }

    let otp;
    let smsSuccess = false;
    let emailSuccess = false;

    // 1. Attempt SMS delivery via Bulk9 helper (which also persists the OTP in DB)
    try {
        otp = await sendOtpHelper(mobile_number, "forgot_password", { name: user.name || "Customer" });
        smsSuccess = true;
        console.log(`Forgot password SMS OTP generated and sent for ${mobile_number}`);
    } catch (smsErr) {
        console.error("Forgot password SMS dispatch failed:", smsErr);
    }

    // 2. Attempt Email delivery copy if user has an email address
    if (user.email) {
        try {
            if (otp !== undefined) {
                await sendEmailOtp(mobile_number, user.email, "forgot_password", otp);
            } else {
                otp = await sendEmailOtp(mobile_number, user.email, "forgot_password");
            }
            emailSuccess = true;
            console.log(`Forgot password Email OTP sent to ${user.email}`);
        } catch (emailErr) {
            console.error("Forgot password Email dispatch failed:", emailErr);
        }
    }

    res.status(200).json({ 
        success: true, 
        message: "OTP sent successfully" 
    });
});


// ---------------------------------------------------------------------------
// PUT /api/user/:id  –  Update user profile
// ---------------------------------------------------------------------------
// Access rules:
//   admin     → can edit any user; may also set admin-only fields
//   franchaise → can edit their own profile OR any merchant whose franchaise_id matches
//   merchant  → can only edit their own profile
//
// Admin-only fields: status, is_approved, settlement_type, franchaise_id, ipay_outlet_id, role
// File fields (multipart): pan_photo, aadhar_photo, aadhar_back_photo, shop_photo
// ---------------------------------------------------------------------------
const updateUser = asyncHandler(async (req, res) => {
  try {
    const requesterId = req.user.id;
    const requesterRole = normalizeRole(req.user.role);
    const targetId = parseInt(req.params.id);

    if (!targetId || isNaN(targetId)) {
      return res.status(400).json({ success: false, message: 'Valid user id is required.' });
    }

    const settlementUpdateFields = new Set(['settlement_type', 't0_daily_limit']);
    const requestFields = Object.keys(req.body || {});
    const isSettlementOnlyUpdate = requestFields.length > 0 && requestFields.every((field) => settlementUpdateFields.has(field));

    if (
      isEmployee(req.user) &&
      !hasPermission(req.user, EMPLOYEE_PERMISSIONS.USERS_UPDATE) &&
      !(isSettlementOnlyUpdate && hasPermission(req.user, EMPLOYEE_PERMISSIONS.SETTLEMENT_MANAGE))
    ) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update users.',
      });
    }

    const targetUser = await User.findByPk(targetId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const permissionsFieldProvided = req.body.permissions !== undefined;
    const parsedEmployeeAccessRoleId = parseEmployeeAccessRoleIdInput(req.body.employee_access_role_id);
    if (parsedEmployeeAccessRoleId.error) {
      return res.status(400).json({ success: false, message: parsedEmployeeAccessRoleId.error });
    }

    const roleFieldProvided = req.body.role !== undefined;
    const settlementTypeProvided = req.body.settlement_type !== undefined;
    const settlementLimitProvided = req.body.t0_daily_limit !== undefined;
    const employeeAccessRoleFieldProvided = parsedEmployeeAccessRoleId.provided;
    const currentTargetRole = normalizeRole(targetUser.role);
    const requestedRole = roleFieldProvided ? normalizeRole(req.body.role) : currentTargetRole;
    const allowedRoles = ['merchant', 'franchaise', 'admin', 'employee'];

    if (
      isEmployee(req.user) &&
      (settlementTypeProvided || settlementLimitProvided) &&
      !hasPermission(req.user, EMPLOYEE_PERMISSIONS.SETTLEMENT_MANAGE)
    ) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to manage settlement settings.',
      });
    }

    if (roleFieldProvided && !allowedRoles.includes(requestedRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role: '${req.body.role}'. Allowed values are: merchant, franchise, admin, employee`,
      });
    }

    if (requesterRole !== 'admin' && (roleFieldProvided || permissionsFieldProvided || employeeAccessRoleFieldProvided)) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update role or employee access controls.',
      });
    }

    if (settlementTypeProvided && requesterRole !== 'admin') {
      if (!isEmployee(req.user) || !hasPermission(req.user, EMPLOYEE_PERMISSIONS.SETTLEMENT_MANAGE)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to manage settlement settings.',
        });
      }
    }

    if (permissionsFieldProvided) {
      return res.status(400).json({
        success: false,
        message: 'Direct employee permissions are deprecated. Assign employee_access_role_id instead.',
      });
    }

    if (employeeAccessRoleFieldProvided && requestedRole !== 'employee') {
      return res.status(400).json({
        success: false,
        message: 'employee_access_role_id can only be set for employee users.',
      });
    }

    const effectiveEmployeeAccessRoleId = requestedRole === 'employee'
      ? (employeeAccessRoleFieldProvided
        ? parsedEmployeeAccessRoleId.employeeAccessRoleId
        : targetUser.employee_access_role_id)
      : null;

    if (requestedRole === 'employee' && !effectiveEmployeeAccessRoleId) {
      return res.status(400).json({
        success: false,
        message: 'employee_access_role_id is required for employee users.',
      });
    }

    const employeeAccessRole = effectiveEmployeeAccessRoleId
      ? await getEmployeeAccessRoleById(effectiveEmployeeAccessRoleId)
      : null;

    if (requestedRole === 'employee' && !employeeAccessRole) {
      return res.status(400).json({
        success: false,
        message: 'Employee access role not found.',
      });
    }

    if (employeeAccessRole && employeeAccessRole.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Only active employee access roles can be assigned.',
      });
    }

    // username is system-generated; ignore any attempt to set it via API
    if (req.body.username !== undefined) {
      delete req.body.username;
    }

    // ── Access control ────────────────────────────────────────────────────
    if (requesterRole === 'merchant') {
      if (requesterId !== targetId) {
        return res.status(403).json({ success: false, message: 'You can only edit your own profile.' });
      }
    }

    if (requesterRole === 'franchaise') {
      if (!canFranchiseAccessTarget(req.user, targetUser)) {
        return res.status(403).json({
          success: false,
          message: 'You can only edit your own profile or your own merchants.',
        });
      }
    }

    // ── Build update payload ──────────────────────────────────────────────
    // Fields any authenticated role may update on an allowed target:
    const commonFields = [
      'name', 'email', 'gender', 'dob', 'mobile_number',
      'mobile_number_country_code', 'address1', 'address2',
      'city', 'district', 'pincode', 'state', 'country',
      'aadhar_number', 'pan_number', 'organization_name',
      'company_or_shop_name',
    ];

    // Fields only admin may touch:
    const adminOnlyFields = [
      'status', 'is_approved',
      'franchaise_id', 'ipay_outlet_id', 'role', 'is_payout_enabled',
      't0_daily_limit',
    ];

    const updates = {};

    for (const field of commonFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (isEmployee(req.user) && (updates.mobile_number === "" || !updates.mobile_number)) {
      delete updates.mobile_number;
    }

    if (requesterRole === 'admin') {
      for (const field of adminOnlyFields) {
        if (req.body[field] !== undefined) {
          if (field === 'role') {
            updates.role = requestedRole;
          } else if (field === 't0_daily_limit') {
            const val = req.body.t0_daily_limit;
            updates.t0_daily_limit = (val !== null && val !== undefined && val !== '') ? parseFloat(val) : null;
          } else {
            updates[field] = req.body[field];
          }
        }
      }
      if (settlementTypeProvided) {
        updates.settlement_type = req.body.settlement_type;
      }

      if (requestedRole === 'employee') {
        updates.employee_access_role_id = employeeAccessRole.id;
        updates.permissions = [];
      } else if (currentTargetRole === 'employee' || targetUser.employee_access_role_id) {
        updates.employee_access_role_id = null;
        updates.permissions = [];
      }
    } else if (settlementTypeProvided && isEmployee(req.user)
      && hasPermission(req.user, EMPLOYEE_PERMISSIONS.SETTLEMENT_MANAGE)) {
      updates.settlement_type = req.body.settlement_type;
    }

    // ── Handle T0 Daily Limit update with Franchise Pool validation ─────
    if (req.body.t0_daily_limit !== undefined) {
      let newLimit = null;
      if (req.body.t0_daily_limit !== null && req.body.t0_daily_limit !== '' && req.body.t0_daily_limit !== undefined) {
        newLimit = parseFloat(req.body.t0_daily_limit);
        if (isNaN(newLimit) || newLimit < 0) {
          return res.status(400).json({ success: false, message: 't0_daily_limit must be a valid non-negative number or null' });
        }
      }

      await validateMerchantT0Limit({
        targetUser,
        requestedLimit: newLimit,
        requesterUser: req.user,
      });

      updates.t0_daily_limit = newLimit;
    }

    // ── File uploads (Cloudinary) ─────────────────────────────────────────
    const panFile          = req.files?.pan_photo;
    const aadharFile       = req.files?.aadhar_photo;
    const aadharBkFile     = req.files?.aadhar_back_photo;
    const shopFile         = req.files?.shop_photo;
    const bankPassbookFile = req.files?.bank_passbook;

    if (panFile || aadharFile || aadharBkFile || shopFile || bankPassbookFile) {
      const [panUrl, aadharUrl, aadharBkUrl, shopUrl, bankPassbookUrl] = await Promise.all([
        panFile          ? cloudinary.uploader.upload(panFile.tempFilePath,          { folder: 'users' }) : null,
        aadharFile       ? cloudinary.uploader.upload(aadharFile.tempFilePath,       { folder: 'users' }) : null,
        aadharBkFile     ? cloudinary.uploader.upload(aadharBkFile.tempFilePath,     { folder: 'users' }) : null,
        shopFile         ? cloudinary.uploader.upload(shopFile.tempFilePath,         { folder: 'users' }) : null,
        bankPassbookFile ? cloudinary.uploader.upload(bankPassbookFile.tempFilePath, { folder: 'users' }) : null,
      ]);

      if (panUrl)           updates.pan_number_url          = panUrl.secure_url;
      if (aadharUrl)        updates.aadhar_number_url       = aadharUrl.secure_url;
      if (aadharBkUrl)      updates.aadhar_back_number_url  = aadharBkUrl.secure_url;
      if (shopUrl)          updates.shop_with_photo_url     = shopUrl.secure_url;
      if (bankPassbookUrl)  updates.bank_passbook_url       = bankPassbookUrl.secure_url;
    }

    // ── Email / mobile uniqueness check ───────────────────────────────────
    if (updates.email && updates.email !== targetUser.email) {
      const emailTaken = await User.findOne({
        where: { email: updates.email, id: { [Op.ne]: targetId } },
      });
      if (emailTaken) {
        return res.status(409).json({ success: false, message: 'Email is already in use by another account.' });
      }
    }

    if (updates.mobile_number && updates.mobile_number !== targetUser.mobile_number) {
      const mobileTaken = await User.findOne({
        where: { mobile_number: updates.mobile_number, id: { [Op.ne]: targetId } },
      });
      if (mobileTaken) {
        return res.status(409).json({ success: false, message: 'Mobile number is already in use by another account.' });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No updatable fields provided.' });
    }

    // ── Persist ───────────────────────────────────────────────────────────
    const prevSettlementType = targetUser.settlement_type || 'today_settlement';
    await targetUser.update(updates);
    
    if (updates.settlement_type && updates.settlement_type !== prevSettlementType) {
      const isTodayNew = updates.settlement_type === 'today_settlement';
      const isTodayPrev = prevSettlementType === 'today_settlement';
  
      await ServiceToggleAuditLog.create({
        user_id: req.user.id,
        affected_user_id: targetUser.id,
        service_key: 'settlement_type',
        previous_state: isTodayPrev,
        new_state: isTodayNew,
        action: isTodayNew ? 'T0' : 'T+1',
        ip_address: extractClientIp(req),
        user_agent: req.headers ? (req.headers['user-agent'] || null) : null,
      });
    }

    await targetUser.reload();

    // Strip sensitive fields before responding
    const { password: _pw, ...safeUser } = serializeUserWithResolvedAccessRole(
      targetUser,
      targetUser.employee_access_role_id
        ? await getEmployeeAccessRoleById(targetUser.employee_access_role_id)
        : null
    );

    return res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      data: safeUser,
    });
  } catch (error) {
    console.error('updateUser error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong.',
    });
  }
});

const promoteEmployeeToAdmin = asyncHandler(async (req, res) => {
  const requesterRole = normalizeRole(req.user?.role);
  if (requesterRole !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only.' });
  }

  const targetId = parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ success: false, message: 'Valid user ID is required.' });
  }

  const targetUser = await User.findByPk(targetId);
  if (!targetUser) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  const currentTargetRole = normalizeRole(targetUser.role);
  if (currentTargetRole !== 'employee') {
    return res.status(400).json({
      success: false,
      message: 'Only employee users can be promoted to admin.',
    });
  }

  await targetUser.update({
    role: 'admin',
    employee_access_role_id: null,
    permissions: [],
  });
  await targetUser.reload();

  const { password: _pw, ...safeUser } = serializeUserWithResolvedAccessRole(targetUser, null);
  return res.status(200).json({
    success: true,
    message: 'User promoted to admin successfully.',
    data: safeUser,
  });
});

const promoteUserToFranchise = asyncHandler(async (req, res) => {
  const requesterRole = req.user?.role;
  const requesterId = req.user?.id;

  // Restrict to admin, and franchise may promote own merchants only.
  if (requesterRole !== 'admin' && requesterRole !== 'franchaise') {
    return res.status(403).json({ success: false, message: 'Admin or franchise role required.' });
  }

  const targetId = parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ success: false, message: 'Valid user ID is required.' });
  }

  const targetUser = await User.findByPk(targetId);
  if (!targetUser) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  // Franchise can only promote their own merchants
  if (requesterRole === 'franchaise' && targetUser.franchaise_id !== requesterId) {
    return res.status(403).json({ success: false, message: 'You can only promote your own merchant users.' });
  }

  const normalizedTargetRole = targetUser.role === 'franchise' ? 'franchaise' : targetUser.role;
  if (normalizedTargetRole === 'franchaise') {
    return res.status(400).json({ success: false, message: 'User is already a franchise.' });
  }

  if (normalizedTargetRole === 'admin') {
    return res.status(400).json({ success: false, message: 'Cannot promote admin user.' });
  }

  const trx = await db.transaction();
  try {
    // Derive candidate username from existing merchant username (APM → APF), then
    // check for conflicts. If the derived name is already taken, fall back to
    // allocating a fresh sequence-based franchise username.
    let newUsername = null;
    if (targetUser.username && /^APM(\d{5})$/.test(targetUser.username)) {
      const candidate = targetUser.username.replace(/^APM/, 'APF');
      const conflict = await User.findOne({
        where: {
          id: { [Op.ne]: targetUser.id },
          [Op.or]: [{ username: candidate }, { abheepay_id: candidate }],
        },
        transaction: trx,
      });
      if (!conflict) {
        newUsername = candidate;
      }
    }

    // If no valid derived name, generate a new one from the sequence.
    if (!newUsername) {
      newUsername = await allocateUsernameForRole('franchaise', trx);
    }

    targetUser.role = 'franchaise';
    targetUser.username = newUsername;
    targetUser.abheepay_id = newUsername;
    targetUser.franchaise_id = null;
    targetUser.is_approved = true;
    targetUser.status = 'active';

    await targetUser.save({ transaction: trx });
    await trx.commit();

    const { password: _pw, ...safeUser } = serializeUserWithResolvedAccessRole(targetUser, null);
    return res.status(200).json({
      success: true,
      message: 'User promoted to franchise successfully.',
      data: safeUser,
    });
  } catch (error) {
    await trx.rollback();
    console.error('promoteUserToFranchise error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to promote user.' });
  }
});

const promoteUserToSuperFranchise = asyncHandler(async (req, res) => {
  const requesterRole = normalizeRole(req.user?.role);

  if (requesterRole !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin role required to promote user to super franchise.' });
  }

  const targetId = parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ success: false, message: 'Valid user ID is required.' });
  }

  const targetUser = await User.findByPk(targetId);
  if (!targetUser) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  const normalizedTargetRole = normalizeRole(targetUser.role);
  if (normalizedTargetRole === 'super_franchise') {
    return res.status(400).json({ success: false, message: 'User is already a super franchise.' });
  }

  if (normalizedTargetRole === 'admin') {
    return res.status(400).json({ success: false, message: 'Cannot promote admin user.' });
  }

  const trx = await db.transaction();
  try {
    let newUsername = null;
    if (targetUser.username && /^(APM|APF)(\d{5})$/.test(targetUser.username)) {
      const candidate = targetUser.username.replace(/^(APM|APF)/, 'APSF');
      const conflict = await User.findOne({
        where: {
          id: { [Op.ne]: targetUser.id },
          [Op.or]: [{ username: candidate }, { abheepay_id: candidate }],
        },
        transaction: trx,
      });
      if (!conflict) {
        newUsername = candidate;
      }
    }

    if (!newUsername) {
      newUsername = await allocateUsernameForRole('super_franchise', trx);
    }

    targetUser.role = 'super_franchise';
    targetUser.username = newUsername;
    targetUser.abheepay_id = newUsername;
    targetUser.franchaise_id = null;
    targetUser.super_franchise_id = null;
    targetUser.is_approved = true;
    targetUser.status = 'active';

    await targetUser.save({ transaction: trx });
    await trx.commit();

    const { password: _pw, ...safeUser } = serializeUserWithResolvedAccessRole(targetUser, null);
    return res.status(200).json({
      success: true,
      message: 'User promoted to Super Franchise successfully.',
      data: safeUser,
    });
  } catch (error) {
    await trx.rollback();
    console.error('promoteUserToSuperFranchise error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to promote user.' });
  }
});

/**
 * PUT /api/user/:id/enable-ledger
 * Admin or employee with ledger.manage. Enables ledger tracking for the specified user (start_ledger = true).
 * There is intentionally no route to set it back to false.
 */
const enableLedger = asyncHandler(async (req, res) => {
  const isElevatedEmployee = req.user?.original_role === 'employee'
    && Array.isArray(req.user?.employee_permission_elevation)
    && req.user.employee_permission_elevation.includes(EMPLOYEE_PERMISSIONS.LEDGER_MANAGE);

  if (req.user.role !== 'admin' && !isElevatedEmployee) {
    res.status(403);
    throw new Error('Only admins or permitted employees can enable ledger tracking');
  }

  const targetUser = await User.findByPk(req.params.id);
  if (!targetUser) {
    res.status(404);
    throw new Error('User not found');
  }

  if (targetUser.start_ledger) {
    return res.status(200).json({
      success: true,
      message: 'Ledger tracking is already enabled for this user',
      id: targetUser.id,
      start_ledger: true,
    });
  }

  targetUser.start_ledger = true;
  await targetUser.save();

  return res.status(200).json({
    success: true,
    message: 'Ledger tracking enabled successfully',
    id: targetUser.id,
    start_ledger: true,
  });
});

module.exports = { registerUser, loginUser, currentUser, approveUser, getUsers, searchUsers, getUserByID, userCount, updatePassword, updateUser, promoteUserToFranchise, promoteUserToSuperFranchise, promoteEmployeeToAdmin, updateUserStatus, updateFranchaiseID, sendOtp, sendOtp_bck, verifyOtp, verifyOtp_bck, resetPassword, generateTpin, verifyTpin, forgotPassword, enableLedger }

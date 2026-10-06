const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const EmployeeAccessRole = require("../models/EmployeeAccessRole");
const {
  buildEmployeeAccessRoleSummary,
  getResolvedPermissions,
  normalizePermissions,
  normalizeRole,
} = require("../utils/permissions");

const AUTH_USER_ATTRIBUTES = [
  'id',
  'name',
  'username',
  'mobile_number',
  'role',
  'status',
  'ipay_outlet_id',
  'permissions',
  'employee_access_role_id',
  'company_id',
];

function buildAuthUser(userLike) {
  const employeeAccessRole = userLike.employee_access_role || userLike.employeeAccessRole || null;
  const normalizedEmployeeAccessRole = employeeAccessRole
    ? {
      ...buildEmployeeAccessRoleSummary(employeeAccessRole),
      permissions: normalizePermissions(employeeAccessRole.permissions),
    }
    : null;

  return {
    id: userLike.id,
    name: userLike.name || null,
    username: userLike.username || null,
    mobile_number: userLike.mobile_number || null,
    role: normalizeRole(userLike.role || 'merchant'),
    status: userLike.status || 'active',
    ipay_outlet_id: userLike.ipay_outlet_id || null,
    company_id: userLike.company_id || null,
    employee_access_role_id: userLike.employee_access_role_id || normalizedEmployeeAccessRole?.id || null,
    employee_access_role: normalizedEmployeeAccessRole,
    permissions: getResolvedPermissions({
      ...userLike,
      employee_access_role: normalizedEmployeeAccessRole,
    }),
  };
}

const validateToken = asyncHandler(async (req, res, next) => {
    console.log("header", req.headers)
    let authHeader = req.headers.Authorization || req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401);
        throw new Error("No token provided. Authorization denied.");
    }

    const token = authHeader.split(" ")[1];
    let decoded;

    try {
        const secret = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || "supersecretjwtsecretkey12345";
        decoded = jwt.verify(token, secret);
    } catch (_error) {
        res.status(401);
        throw new Error("User is not authorized.");
    }

    const decodedUser = decoded?.user || {};
    const shouldUseFreshDbUser = process.env.NODE_ENV !== 'test' || process.env.ENFORCE_DB_AUTH === 'true';

    if (!shouldUseFreshDbUser) {
        req.user = buildAuthUser(decodedUser);
        return next();
    }

    const freshUser = decodedUser.id
        ? await User.findByPk(decodedUser.id, { attributes: AUTH_USER_ATTRIBUTES })
        : null;

    if (!freshUser) {
        res.status(401);
        throw new Error("User is not authorized.");
    }

    if (freshUser.status !== 'active') {
        res.status(401);
        throw new Error("User account is inactive.");
    }

    const employeeAccessRole = freshUser.employee_access_role_id
        ? await EmployeeAccessRole.findByPk(freshUser.employee_access_role_id)
        : null;

    const freshUserPayload = freshUser.toJSON ? freshUser.toJSON() : { ...freshUser };
    req.user = buildAuthUser({
      ...freshUserPayload,
      employee_access_role: employeeAccessRole
        ? (employeeAccessRole.toJSON ? employeeAccessRole.toJSON() : { ...employeeAccessRole })
        : null,
    });
    next();
});

module.exports = validateToken

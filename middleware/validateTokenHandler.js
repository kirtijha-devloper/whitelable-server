const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { normalizePermissions, normalizeRole } = require("../utils/permissions");

const AUTH_USER_ATTRIBUTES = [
  'id',
  'name',
  'mobile_number',
  'role',
  'status',
  'ipay_outlet_id',
  'permissions',
];

function buildAuthUser(userLike) {
  return {
    id: userLike.id,
    name: userLike.name || null,
    mobile_number: userLike.mobile_number || null,
    role: normalizeRole(userLike.role || 'merchant'),
    status: userLike.status || 'active',
    ipay_outlet_id: userLike.ipay_outlet_id || null,
    permissions: normalizePermissions(userLike.permissions),
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
        decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
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

    req.user = buildAuthUser(freshUser);
    next();
});

module.exports = validateToken

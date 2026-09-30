/**
 * directLoginController.js
 *
 * Allows an authenticated admin, or a permitted employee, to log in AS another
 * user without knowing their password — for support and debugging purposes.
 *
 * ── Endpoints ──────────────────────────────────────────────────────────────
 *
 *  POST /api/admin/dl-token
 *    Admin or an employee with impersonation permission generates (or
 *    regenerates) their Direct-Login token.
 *    Returns the raw token ONCE.  Store it in the admin UI session.
 *    Any previously active token for this admin is deleted immediately.
 *
 *  GET  /api/admin/dl-token/status
 *    Returns whether the current privileged user has an active DL token + its expiry.
 *    Does NOT return the raw token (it is hashed server-side).
 *
 *  DELETE /api/admin/dl-token
 *    Revoke the current DL token immediately.
 *
 *  POST /api/auth/direct-login
 *    Public endpoint (no admin token needed here — the DL token IS the proof).
 *    Body: { dl_token, user_id }
 *    Returns a normal 5-hour JWT for the target user.
 *
 * ── Security design ────────────────────────────────────────────────────────
 *  • Token is 32 cryptographically random bytes (256 bits entropy).
 *  • Only the SHA-256 hash is stored in the database.
 *  • Token lifetime: DL_TOKEN_TTL_MINUTES env var (default 120 min / 2 h).
 *  • Each (dl_token, user_id) pair is single-use — replayed requests
 *    (double-click, tab reload) return the original JWT without re-issuing.
 *  • Admin-owned tokens may target merchants, franchisees, and employees.
 *  • Employee-owned tokens may target merchants and franchisees only.
 *  • Admin accounts are always blocked as impersonation targets.
 *  • Inactive user accounts are rejected.
 */

const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');

const User = require('../models/User');
const EmployeeAccessRole = require('../models/EmployeeAccessRole');
const DirectLoginToken = require('../models/DirectLoginToken');
const {
  EMPLOYEE_PERMISSIONS,
  hasPermission,
  normalizeRole,
} = require('../utils/permissions');

const DIRECT_LOGIN_OWNER_ATTRIBUTES = [
  'id',
  'name',
  'username',
  'email',
  'abheepay_id',
  'mobile_number',
  'role',
  'status',
  'employee_access_role_id',
];
const ADMIN_IMPERSONATABLE_ROLES = ['merchant', 'franchaise', 'franchise', 'super_franchise', 'employee'];
const EMPLOYEE_IMPERSONATABLE_ROLES = ['merchant', 'franchaise', 'franchise', 'super_franchise'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TTL_MINUTES = parseInt(process.env.DL_TOKEN_TTL_MINUTES || '120', 10);

/** SHA-256 hex digest of a raw string token. */
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Build an expiry Date from now + TTL_MINUTES. */
function newExpiry() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + TTL_MINUTES);
  return d;
}

/** Parse the used_user_ids JSON array safely. */
function parseUsedIds(text) {
  try {
    const parsed = JSON.parse(text || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Default 5 test users from Screenshot 2:
// APM00009 (9262914251), APM00008 (9262914250), APF00004 (9091325033), APF00003 (1234567892), APF00001 (123456789)
const DEFAULT_TEST_USER_IDENTIFIERS = [
  'APM00009', '9262914251',
  'APM00008', '9262914250',
  'APF00004', '9091325033',
  'APF00003', '1234567892',
  'APF00001', '123456789',
];

const DEFAULT_PRIMARY_ADMIN_IDENTIFIERS = [
  'APA00001',
  '8119865074',
  '9990450938',
  'admin@abheepay.com',
  '1',
];

function getPrimaryAdminIdentifiers() {
  const envValue = process.env.PRIMARY_ADMIN_IDENTIFIERS || process.env.PRIMARY_ADMIN_ABHEEPAY_IDS;
  if (!envValue) return DEFAULT_PRIMARY_ADMIN_IDENTIFIERS;
  return envValue.split(',').map((item) => item.trim()).filter(Boolean);
}

function getTestUserIdentifiers() {
  const envValue = process.env.ALLOWED_TEST_USER_IDENTIFIERS;
  if (!envValue) return DEFAULT_TEST_USER_IDENTIFIERS;
  return envValue.split(',').map((item) => item.trim()).filter(Boolean);
}

function isPrimaryAdmin(user) {
  if (!user || normalizeRole(user.role) !== 'admin') {
    return false;
  }
  const primaryList = getPrimaryAdminIdentifiers();
  const userIdStr = String(user.id || '');
  const abheepayIdStr = String(user.abheepay_id || '').toUpperCase();
  const mobileStr = String(user.mobile_number || '');
  const emailStr = String(user.email || '').toLowerCase();
  const usernameStr = String(user.username || '').toUpperCase();

  return primaryList.some((item) => {
    const norm = String(item).trim();
    if (!norm) return false;
    const normUpper = norm.toUpperCase();
    const normLower = norm.toLowerCase();
    return (
      userIdStr === norm ||
      abheepayIdStr === normUpper ||
      usernameStr === normUpper ||
      mobileStr === norm ||
      emailStr === normLower
    );
  });
}

function isAllowedTestUser(targetUser) {
  if (!targetUser) return false;
  const testList = getTestUserIdentifiers();
  const userIdStr = String(targetUser.id || '');
  const abheepayIdStr = String(targetUser.abheepay_id || '').toUpperCase();
  const mobileStr = String(targetUser.mobile_number || '');
  const usernameStr = String(targetUser.username || '').toUpperCase();

  return testList.some((item) => {
    const norm = String(item).trim();
    if (!norm) return false;
    const normUpper = norm.toUpperCase();
    return (
      userIdStr === norm ||
      abheepayIdStr === normUpper ||
      usernameStr === normUpper ||
      mobileStr === norm
    );
  });
}

function canManageDirectLoginTokens(user) {
  return normalizeRole(user?.role) === 'admin'
    || hasPermission(user, EMPLOYEE_PERMISSIONS.USERS_IMPERSONATE);
}

function getDirectLoginAccessDeniedMessage() {
  return 'You do not have permission to manage impersonation login.';
}

async function loadTokenOwner(ownerId) {
  const owner = await User.findByPk(ownerId, { attributes: DIRECT_LOGIN_OWNER_ATTRIBUTES });
  if (!owner) {
    return null;
  }

  const plainOwner = owner.toJSON ? owner.toJSON() : { ...owner };
  const employeeAccessRole = plainOwner.employee_access_role_id
    ? await EmployeeAccessRole.findByPk(plainOwner.employee_access_role_id)
    : null;

  return {
    ...plainOwner,
    role: normalizeRole(plainOwner.role),
    employee_access_role: employeeAccessRole
      ? (employeeAccessRole.toJSON ? employeeAccessRole.toJSON() : { ...employeeAccessRole })
      : null,
  };
}

function getImpersonatableRolesForOwner(owner) {
  const ownerRole = normalizeRole(owner?.role);

  if (ownerRole === 'admin') {
    return ADMIN_IMPERSONATABLE_ROLES;
  }

  if (ownerRole === 'employee' && hasPermission(owner, EMPLOYEE_PERMISSIONS.USERS_IMPERSONATE)) {
    return EMPLOYEE_IMPERSONATABLE_ROLES;
  }

  return [];
}

/** Issue a standard 5-hour user JWT (same shape as normal login). */
function issueUserJwt(user) {
  return jwt.sign(
    {
      user: {
        id: user.id,
        name: user.name,
        mobile_number: user.mobile_number,
        role: user.role,
        ipay_outlet_id: user.ipay_outlet_id || null,
      },
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '5h' }
  );
}

// ---------------------------------------------------------------------------
// POST /api/admin/dl-token  –  Generate / regenerate DL token
// ---------------------------------------------------------------------------
const generateDlToken = asyncHandler(async (req, res) => {
  if (!canManageDirectLoginTokens(req.user)) {
    return res.status(403).json({ success: false, message: getDirectLoginAccessDeniedMessage() });
  }

  const tokenOwnerId = req.user.id;

  // The DB column remains admin_id for backward compatibility, but it now stores
  // the privileged token owner's user id (admin or impersonation-enabled employee).
  await DirectLoginToken.destroy({ where: { admin_id: tokenOwnerId } });

  // Generate a cryptographically random 32-byte token
  const rawToken = crypto.randomBytes(32).toString('hex'); // 64 hex chars
  const tokenHash = hashToken(rawToken);
  const expiresAt = newExpiry();

  await DirectLoginToken.create({
    admin_id: tokenOwnerId,
    token_hash: tokenHash,
    expires_at: expiresAt,
    used_user_ids: '[]',
  });

  return res.status(201).json({
    success: true,
    message: `Direct-login token generated. Valid for ${TTL_MINUTES} minutes.`,
    data: {
      dl_token: rawToken,        // ← raw token returned ONCE; hash is stored
      expires_at: expiresAt,
      ttl_minutes: TTL_MINUTES,
      warning:
        'Store this token in your session. It cannot be retrieved again — you must regenerate if lost.',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/dl-token/status  –  Check if active token exists
// ---------------------------------------------------------------------------
const getDlTokenStatus = asyncHandler(async (req, res) => {
  if (!canManageDirectLoginTokens(req.user)) {
    return res.status(403).json({ success: false, message: getDirectLoginAccessDeniedMessage() });
  }

  const record = await DirectLoginToken.findOne({
    where: {
      admin_id: req.user.id,
      expires_at: { [Op.gt]: new Date() },
    },
  });

  if (!record) {
    return res.status(200).json({
      success: true,
      active: false,
      message: 'No active direct-login token. Call POST /api/admin/dl-token to generate one.',
    });
  }

  const usedIds = parseUsedIds(record.used_user_ids);

  return res.status(200).json({
    success: true,
    active: true,
    data: {
      expires_at: record.expires_at,
      used_user_ids_count: usedIds.length,
      created_at: record.createdAt,
    },
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/dl-token  –  Revoke active token
// ---------------------------------------------------------------------------
const revokeDlToken = asyncHandler(async (req, res) => {
  if (!canManageDirectLoginTokens(req.user)) {
    return res.status(403).json({ success: false, message: getDirectLoginAccessDeniedMessage() });
  }

  const deleted = await DirectLoginToken.destroy({
    where: { admin_id: req.user.id },
  });

  return res.status(200).json({
    success: true,
    message: deleted
      ? 'Direct-login token revoked successfully.'
      : 'No active token found to revoke.',
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/direct-login  –  Exchange DL token + user_id for user JWT
// ---------------------------------------------------------------------------
const directLogin = asyncHandler(async (req, res) => {
  const { dl_token, user_id } = req.body;

  // ── 1. Basic validation ──────────────────────────────────────────────────
  if (!dl_token || typeof dl_token !== 'string' || dl_token.trim() === '') {
    return res.status(400).json({ success: false, message: 'dl_token is required.' });
  }

  if (!user_id || isNaN(parseInt(user_id))) {
    return res.status(400).json({ success: false, message: 'user_id is required and must be a number.' });
  }

  const targetUserId = parseInt(user_id);
  const incomingHash = hashToken(dl_token.trim());

  // ── 2. Look up token record ──────────────────────────────────────────────
  const tokenRecord = await DirectLoginToken.findOne({
    where: {
      token_hash: incomingHash,
      expires_at: { [Op.gt]: new Date() }, // not yet expired
    },
  });

  if (!tokenRecord) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired direct-login token.',
    });
  }

  const tokenOwner = await loadTokenOwner(tokenRecord.admin_id);
  if (!tokenOwner || tokenOwner.status !== 'active') {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired direct-login token.',
    });
  }

  const allowedTargetRoles = getImpersonatableRolesForOwner(tokenOwner);
  if (allowedTargetRoles.length === 0) {
    return res.status(403).json({
      success: false,
      message: 'Direct-login token owner is no longer authorized to impersonate users.',
    });
  }

  // ── 3. Replay guard (idempotent for same user_id) ────────────────────────
  //  If this (token, user_id) pair was already used, return the same 200 but
  //  do NOT issue a new JWT — the client already has it from the first call.
  const usedIds = parseUsedIds(tokenRecord.used_user_ids);

  if (usedIds.includes(targetUserId)) {
    return res.status(409).json({
      success: false,
      message:
        'This user has already been logged in via this token. ' +
        'Generate a new DL token or open the user from a fresh privileged session.',
    });
  }

  // ── 4. Validate target user ──────────────────────────────────────────────
  const targetUser = await User.findOne({
    where: {
      id: targetUserId,
      role: { [Op.in]: allowedTargetRoles },
    },
  });

  if (!targetUser) {
    return res.status(404).json({
      success: false,
      message: 'Target user not found or cannot be impersonated by this login token.',
    });
  }

  if (targetUser.status !== 'active') {
    return res.status(422).json({
      success: false,
      message: `Target user account is ${targetUser.status}. Cannot log in as an inactive user.`,
    });
  }

  // ── 4b. Enforce Primary Admin vs Rest of Admins/Employees restriction ─────
  // Primary admins can impersonate ANY user.
  // Rest of admins and employees can ONLY impersonate designated test users.
  const isOwnerPrimaryAdmin = isPrimaryAdmin(tokenOwner);
  if (!isOwnerPrimaryAdmin && !isAllowedTestUser(targetUser)) {
    return res.status(403).json({
      success: false,
      message: 'Only primary admins can log in as any user. Rest of admins and employees can only log in as designated test users.',
    });
  }

  // ── 5. Mark this (token, user_id) as used ───────────────────────────────
  usedIds.push(targetUserId);
  await tokenRecord.update({ used_user_ids: JSON.stringify(usedIds) });

  // ── 6. Issue JWT for the target user ────────────────────────────────────
  const accessToken = issueUserJwt(targetUser);

  return res.status(200).json({
    success: true,
    message: `Logged in as ${targetUser.name || targetUser.mobile_number} (${targetUser.role}).`,
    token: accessToken,
    user: {
      id: targetUser.id,
      name: targetUser.name,
      mobile_number: targetUser.mobile_number,
      role: targetUser.role,
      abheepay_id: targetUser.abheepay_id,
      organization_name: targetUser.organization_name,
    },
  });
});

module.exports = {
  generateDlToken,
  getDlTokenStatus,
  revokeDlToken,
  directLogin,
};

const EMPLOYEE_PERMISSIONS = Object.freeze({
  USERS_CREATE: 'users.create',
  USERS_LIST: 'users.list',
  USERS_SEARCH: 'users.search',
  USERS_READ: 'users.read',
  USERS_UPDATE: 'users.update',
  USERS_STATUS_UPDATE: 'users.status.update',
  STOCK_POS_READ: 'stock.pos.read',
  STOCK_POS_MANAGE: 'stock.pos.manage',
  WALLET_READ: 'wallet.read',
  WALLET_MANAGE: 'wallet.manage',
  REPORTS_READ: 'reports.read',
  PAYOUT_READ: 'payout.read',
  LEDGER_READ: 'ledger.read',
  LEDGER_MANAGE: 'ledger.manage',
  COMPLAINTS_READ: 'complaints.read',
  COMPLAINTS_MANAGE: 'complaints.manage',
  RATE_SETTINGS_READ: 'rate.settings.read',
  RATE_SETTINGS_MANAGE: 'rate.settings.manage',
  RAZORPAY_NOTIFICATIONS_LIST: 'razorpay.notifications.list',
  RAZORPAY_NOTIFICATIONS_READ: 'razorpay.notifications.read',
});

const EMPLOYEE_PERMISSION_VALUES = Object.freeze(Object.values(EMPLOYEE_PERMISSIONS));
const EMPLOYEE_PERMISSION_SET = new Set(EMPLOYEE_PERMISSION_VALUES);

function normalizeRole(role) {
  return role === 'franchise' ? 'franchaise' : role;
}

function normalizePermissions(permissions) {
  if (!Array.isArray(permissions)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  for (const permission of permissions) {
    if (typeof permission !== 'string') {
      continue;
    }

    const trimmed = permission.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function parsePermissionsInput(rawPermissions) {
  if (rawPermissions === undefined) {
    return { provided: false, permissions: [] };
  }

  let parsedPermissions = rawPermissions;

  if (typeof rawPermissions === 'string') {
    const trimmed = rawPermissions.trim();
    if (!trimmed) {
      parsedPermissions = [];
    } else {
      try {
        parsedPermissions = JSON.parse(trimmed);
      } catch (_error) {
        return {
          provided: true,
          error: 'permissions must be a JSON array of permission slugs.',
        };
      }
    }
  }

  if (!Array.isArray(parsedPermissions)) {
    return {
      provided: true,
      error: 'permissions must be a JSON array of permission slugs.',
    };
  }

  const permissions = normalizePermissions(parsedPermissions);
  const invalidPermissions = permissions.filter((permission) => !EMPLOYEE_PERMISSION_SET.has(permission));

  if (invalidPermissions.length > 0) {
    return {
      provided: true,
      error: `Invalid permissions: ${invalidPermissions.join(', ')}`,
    };
  }

  return {
    provided: true,
    permissions,
  };
}

function isAdmin(user) {
  return normalizeRole(user?.role) === 'admin';
}

function isEmployee(user) {
  return normalizeRole(user?.role) === 'employee';
}

function hasPermission(user, permission) {
  if (isAdmin(user)) {
    return true;
  }

  if (!isEmployee(user)) {
    return false;
  }

  return normalizePermissions(user.permissions).includes(permission);
}

function hasAnyPermission(user, permissions) {
  if (isAdmin(user)) {
    return true;
  }

  if (!isEmployee(user)) {
    return false;
  }

  const permissionList = Array.isArray(permissions) ? permissions : [permissions];
  const normalizedPermissions = normalizePermissions(user.permissions);

  return permissionList.some((permission) => normalizedPermissions.includes(permission));
}

function getEffectiveRole(user, adminPermissions = []) {
  if (isAdmin(user)) {
    return 'admin';
  }

  if (hasAnyPermission(user, adminPermissions)) {
    return 'admin';
  }

  return normalizeRole(user?.role);
}

function isSelfTarget(requester, targetUser) {
  return Number(requester?.id) === Number(targetUser?.id);
}

function isOwnMerchantTarget(requester, targetUser) {
  return normalizeRole(requester?.role) === 'franchaise'
    && normalizeRole(targetUser?.role) === 'merchant'
    && Number(targetUser?.franchaise_id) === Number(requester?.id);
}

function canFranchiseAccessTarget(requester, targetUser) {
  return isSelfTarget(requester, targetUser) || isOwnMerchantTarget(requester, targetUser);
}

module.exports = {
  EMPLOYEE_PERMISSIONS,
  EMPLOYEE_PERMISSION_VALUES,
  normalizeRole,
  normalizePermissions,
  parsePermissionsInput,
  isAdmin,
  isEmployee,
  hasPermission,
  hasAnyPermission,
  getEffectiveRole,
  isSelfTarget,
  isOwnMerchantTarget,
  canFranchiseAccessTarget,
};

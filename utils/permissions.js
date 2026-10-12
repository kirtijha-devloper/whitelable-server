const EMPLOYEE_PERMISSIONS = Object.freeze({
  USERS_CREATE: 'users.create',
  USERS_LIST: 'users.list',
  USERS_SEARCH: 'users.search',
  USERS_READ: 'users.read',
  USERS_UPDATE: 'users.update',
  USERS_STATUS_UPDATE: 'users.status.update',
  USERS_SETTLEMENT_UPDATE: 'users.settlement.update',
  USERS_IMPERSONATE: 'users.impersonate',
  USERS_SERVICE_SETTINGS_MANAGE: 'users.service_settings.manage',
  STOCK_POS_READ: 'stock.pos.read',
  STOCK_POS_MANAGE: 'stock.pos.manage',
  WALLET_READ: 'wallet.read',
  WALLET_CREDIT: 'wallet.credit',
  WALLET_DEBIT: 'wallet.debit',
  REPORTS_READ: 'reports.read',
  PAYOUT_READ: 'payout.read',
  PAYOUT_MANAGE: 'payout.manage',
  LEDGER_READ: 'ledger.read',
  LEDGER_MANAGE: 'ledger.manage',
  COMPLAINTS_READ: 'complaints.read',
  COMPLAINTS_MANAGE: 'complaints.manage',
  RATE_SETTINGS_READ: 'rate.settings.read',
  RATE_SETTINGS_MANAGE: 'rate.settings.manage',
  SETTLEMENT_READ: 'settlement.read',
  SETTLEMENT_MANAGE: 'settlement.manage',
  RAZORPAY_NOTIFICATIONS_LIST: 'razorpay.notifications.list',
  RAZORPAY_NOTIFICATIONS_READ: 'razorpay.notifications.read',
  SYSTEM_LOGS_READ: 'system.logs.read',
});

const EMPLOYEE_PERMISSION_CATALOG = Object.freeze([
  {
    module: 'users',
    label: 'Users',
    permissions: [
      { slug: EMPLOYEE_PERMISSIONS.USERS_CREATE, label: 'Create User' },
      { slug: EMPLOYEE_PERMISSIONS.USERS_LIST, label: 'User List' },
      { slug: EMPLOYEE_PERMISSIONS.USERS_SEARCH, label: 'Search Users' },
      { slug: EMPLOYEE_PERMISSIONS.USERS_READ, label: 'View User Detail' },
      { slug: EMPLOYEE_PERMISSIONS.USERS_UPDATE, label: 'Edit User' },
      { slug: EMPLOYEE_PERMISSIONS.USERS_STATUS_UPDATE, label: 'Update User Status' },
      { slug: EMPLOYEE_PERMISSIONS.USERS_SETTLEMENT_UPDATE, label: 'Update Settlement Type' },
      { slug: EMPLOYEE_PERMISSIONS.USERS_IMPERSONATE, label: 'Impersonate Login' },
      { slug: EMPLOYEE_PERMISSIONS.USERS_SERVICE_SETTINGS_MANAGE, label: 'Manage User Service Settings' },
    ],
  },
  {
    module: 'stock_pos',
    label: 'Stock POS',
    permissions: [
      { slug: EMPLOYEE_PERMISSIONS.STOCK_POS_READ, label: 'View Stock POS' },
      { slug: EMPLOYEE_PERMISSIONS.STOCK_POS_MANAGE, label: 'Manage Stock POS' },
    ],
  },
  {
    module: 'wallet',
    label: 'Wallet',
    permissions: [
      { slug: EMPLOYEE_PERMISSIONS.WALLET_READ, label: 'View Wallet' },
      { slug: EMPLOYEE_PERMISSIONS.WALLET_CREDIT, label: 'Wallet Credit' },
      { slug: EMPLOYEE_PERMISSIONS.WALLET_DEBIT, label: 'Wallet Debit' },
    ],
  },
  {
    module: 'reports',
    label: 'Reports',
    permissions: [
      { slug: EMPLOYEE_PERMISSIONS.REPORTS_READ, label: 'View Reports' },
    ],
  },
  {
    module: 'payout',
    label: 'Payout',
    permissions: [
      { slug: EMPLOYEE_PERMISSIONS.PAYOUT_READ, label: 'View Payout' },
      { slug: EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE, label: 'Manage Payout' },
    ],
  },
  {
    module: 'ledger',
    label: 'Ledger',
    permissions: [
      { slug: EMPLOYEE_PERMISSIONS.LEDGER_READ, label: 'View Ledger' },
      { slug: EMPLOYEE_PERMISSIONS.LEDGER_MANAGE, label: 'Manage Ledger' },
    ],
  },
  {
    module: 'complaints',
    label: 'Complaint',
    permissions: [
      { slug: EMPLOYEE_PERMISSIONS.COMPLAINTS_READ, label: 'View Complaints' },
      { slug: EMPLOYEE_PERMISSIONS.COMPLAINTS_MANAGE, label: 'Manage Complaints' },
    ],
  },
  {
    module: 'rate_settings',
    label: 'Rate Setting',
    permissions: [
      { slug: EMPLOYEE_PERMISSIONS.RATE_SETTINGS_READ, label: 'View Rate Settings' },
      { slug: EMPLOYEE_PERMISSIONS.RATE_SETTINGS_MANAGE, label: 'Manage Rate Settings' },
    ],
  },
  {
    module: 'settlement',
    label: 'Settlement',
    permissions: [
      { slug: EMPLOYEE_PERMISSIONS.SETTLEMENT_READ, label: 'View Settlement' },
      { slug: EMPLOYEE_PERMISSIONS.SETTLEMENT_MANAGE, label: 'Manage Settlement' },
    ],
  },
  {
    module: 'razorpay_notifications',
    label: 'Razorpay Notifications',
    permissions: [
      { slug: EMPLOYEE_PERMISSIONS.RAZORPAY_NOTIFICATIONS_LIST, label: 'List Razorpay Notifications' },
      { slug: EMPLOYEE_PERMISSIONS.RAZORPAY_NOTIFICATIONS_READ, label: 'View Razorpay Notification Detail' },
    ],
  },
  {
    module: 'system',
    label: 'System',
    permissions: [
      { slug: EMPLOYEE_PERMISSIONS.SYSTEM_LOGS_READ, label: 'View Server Logs' },
    ],
  },
]);

const EMPLOYEE_PERMISSION_VALUES = Object.freeze(Object.values(EMPLOYEE_PERMISSIONS));
const EMPLOYEE_PERMISSION_SET = new Set(EMPLOYEE_PERMISSION_VALUES);

function normalizeRole(role) {
  return role === 'franchise' ? 'franchaise' : role === 'super_franchise' ? 'super_franchise' : role;
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

function buildEmployeeAccessRoleSummary(roleLike) {
  if (!roleLike || typeof roleLike !== 'object') {
    return null;
  }

  return {
    id: roleLike.id ?? null,
    name: roleLike.name || null,
    slug: roleLike.slug || null,
    status: roleLike.status || 'active',
    description: roleLike.description || null,
  };
}

function getEmployeeAccessRoleFromUser(user) {
  return user?.employee_access_role || user?.employeeAccessRole || null;
}

function getResolvedPermissions(user) {
  const normalizedUserRole = normalizeRole(user?.role);

  if (normalizedUserRole === 'employee') {
    const employeeAccessRole = getEmployeeAccessRoleFromUser(user);
    if (!employeeAccessRole || (employeeAccessRole.status && employeeAccessRole.status !== 'active')) {
      return [];
    }

    return normalizePermissions(employeeAccessRole.permissions);
  }

  return normalizePermissions(user?.permissions);
}

function isAdmin(user) {
  const role = normalizeRole(user?.role);
  return role === 'admin' || role === 'super_admin';
}

function isSuperFranchise(user) {
  return normalizeRole(user?.role) === 'super_franchise';
}

function isFranchise(user) {
  const role = normalizeRole(user?.role);
  return role === 'franchaise' || role === 'franchise';
}

function isMerchant(user) {
  return normalizeRole(user?.role) === 'merchant';
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

  return getResolvedPermissions(user).includes(permission);
}

function hasAnyPermission(user, permissions) {
  if (isAdmin(user)) {
    return true;
  }

  if (!isEmployee(user)) {
    return false;
  }

  const permissionList = Array.isArray(permissions) ? permissions : [permissions];
  const normalizedPermissions = getResolvedPermissions(user);

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
  return isFranchise(requester)
    && isMerchant(targetUser)
    && Number(targetUser?.franchaise_id) === Number(requester?.id);
}

function isOwnFranchiseTarget(requester, targetUser) {
  return isSuperFranchise(requester)
    && isFranchise(targetUser)
    && Number(targetUser?.super_franchise_id) === Number(requester?.id);
}

function canFranchiseAccessTarget(requester, targetUser) {
  return isSelfTarget(requester, targetUser) || isOwnMerchantTarget(requester, targetUser);
}

function canSuperFranchiseAccessTarget(requester, targetUser) {
  if (isSelfTarget(requester, targetUser)) return true;
  if (isOwnFranchiseTarget(requester, targetUser)) return true;
  if (isMerchant(targetUser) && Number(targetUser?.super_franchise_id) === Number(requester?.id)) return true;
  return false;
}

module.exports = {
  EMPLOYEE_PERMISSIONS,
  EMPLOYEE_PERMISSION_CATALOG,
  EMPLOYEE_PERMISSION_VALUES,
  normalizeRole,
  normalizePermissions,
  parsePermissionsInput,
  buildEmployeeAccessRoleSummary,
  getResolvedPermissions,
  isAdmin,
  isSuperFranchise,
  isFranchise,
  isMerchant,
  isEmployee,
  hasPermission,
  hasAnyPermission,
  getEffectiveRole,
  isSelfTarget,
  isOwnMerchantTarget,
  isOwnFranchiseTarget,
  canFranchiseAccessTarget,
  canSuperFranchiseAccessTarget,
};

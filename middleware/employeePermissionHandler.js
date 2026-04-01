const {
  hasAnyPermission,
  isEmployee,
} = require('../utils/permissions');

function normalizePermissionsInput(permissions) {
  return Array.isArray(permissions) ? permissions : [permissions];
}

function ensureEmployeePermission(permissions, options = {}) {
  const permissionList = normalizePermissionsInput(permissions);
  const {
    message = 'You do not have permission to access this module.',
    elevateRole,
  } = options;

  return (req, res, next) => {
    if (!isEmployee(req.user)) {
      return next();
    }

    if (!hasAnyPermission(req.user, permissionList)) {
      return res.status(403).json({
        success: false,
        message,
      });
    }

    if (elevateRole) {
      req.user = {
        ...req.user,
        original_role: req.user.role,
        role: elevateRole,
        employee_permission_elevation: permissionList,
      };
    }

    return next();
  };
}

module.exports = {
  ensureEmployeePermission,
};

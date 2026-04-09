const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');

const EmployeeAccessRole = require('../models/EmployeeAccessRole');
const User = require('../models/User');
const {
  EMPLOYEE_PERMISSION_CATALOG,
  parsePermissionsInput,
} = require('../utils/permissions');

function ensureAdmin(req, res) {
  if (req.user?.role !== 'admin') {
    res.status(403);
    throw new Error('Admin access only.');
  }
}

function normalizeStatus(status) {
  if (status === undefined || status === null || status === '') {
    return 'active';
  }

  return String(status).trim().toLowerCase();
}

function slugifyAccessRole(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function serializeEmployeeAccessRole(roleLike) {
  const plain = roleLike?.toJSON ? roleLike.toJSON() : { ...roleLike };
  return {
    id: plain.id,
    name: plain.name,
    slug: plain.slug,
    description: plain.description || null,
    status: plain.status,
    permissions: Array.isArray(plain.permissions) ? plain.permissions : [],
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

const getEmployeeAccessRoleMeta = asyncHandler(async (req, res) => {
  ensureAdmin(req, res);

  return res.status(200).json({
    success: true,
    data: {
      permissions: EMPLOYEE_PERMISSION_CATALOG,
      statuses: ['active', 'inactive'],
    },
  });
});

const listEmployeeAccessRoles = asyncHandler(async (req, res) => {
  ensureAdmin(req, res);

  const where = {};
  if (req.query.status) {
    where.status = normalizeStatus(req.query.status);
  }

  const roles = await EmployeeAccessRole.findAll({
    where,
    order: [['name', 'ASC']],
  });

  return res.status(200).json({
    success: true,
    data: roles.map(serializeEmployeeAccessRole),
  });
});

const getEmployeeAccessRoleById = asyncHandler(async (req, res) => {
  ensureAdmin(req, res);

  const role = await EmployeeAccessRole.findByPk(req.params.id);
  if (!role) {
    return res.status(404).json({
      success: false,
      message: 'Employee access role not found.',
    });
  }

  return res.status(200).json({
    success: true,
    data: serializeEmployeeAccessRole(role),
  });
});

const createEmployeeAccessRole = asyncHandler(async (req, res) => {
  ensureAdmin(req, res);

  const name = String(req.body.name || '').trim();
  const slugInput = String(req.body.slug || '').trim();
  const description = req.body.description ? String(req.body.description).trim() : null;
  const status = normalizeStatus(req.body.status);
  const parsedPermissions = parsePermissionsInput(req.body.permissions);

  if (!name) {
    return res.status(400).json({
      success: false,
      message: 'name is required.',
    });
  }

  if (parsedPermissions.error) {
    return res.status(400).json({
      success: false,
      message: parsedPermissions.error,
    });
  }

  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'status must be either active or inactive.',
    });
  }

  const slug = slugInput || slugifyAccessRole(name);
  if (!slug) {
    return res.status(400).json({
      success: false,
      message: 'slug could not be generated. Provide a valid name or slug.',
    });
  }

  const existingRole = await EmployeeAccessRole.findOne({
    where: {
      [Op.or]: [{ name }, { slug }],
    },
  });

  if (existingRole) {
    return res.status(409).json({
      success: false,
      message: 'Employee access role name or slug already exists.',
    });
  }

  const role = await EmployeeAccessRole.create({
    name,
    slug,
    description,
    status,
    permissions: parsedPermissions.permissions,
  });

  return res.status(201).json({
    success: true,
    message: 'Employee access role created successfully.',
    data: serializeEmployeeAccessRole(role),
  });
});

const updateEmployeeAccessRole = asyncHandler(async (req, res) => {
  ensureAdmin(req, res);

  const role = await EmployeeAccessRole.findByPk(req.params.id);
  if (!role) {
    return res.status(404).json({
      success: false,
      message: 'Employee access role not found.',
    });
  }

  const updates = {};
  const nameProvided = req.body.name !== undefined;
  const slugProvided = req.body.slug !== undefined;
  const descriptionProvided = req.body.description !== undefined;
  const statusProvided = req.body.status !== undefined;
  const permissionsProvided = req.body.permissions !== undefined;

  if (nameProvided) {
    const name = String(req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'name cannot be empty.',
      });
    }
    updates.name = name;
  }

  if (slugProvided) {
    const slug = String(req.body.slug || '').trim() || slugifyAccessRole(updates.name || role.name);
    if (!slug) {
      return res.status(400).json({
        success: false,
        message: 'slug cannot be empty.',
      });
    }
    updates.slug = slug;
  }

  if (descriptionProvided) {
    updates.description = req.body.description ? String(req.body.description).trim() : null;
  }

  if (statusProvided) {
    const status = normalizeStatus(req.body.status);
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'status must be either active or inactive.',
      });
    }
    updates.status = status;
  }

  if (permissionsProvided) {
    const parsedPermissions = parsePermissionsInput(req.body.permissions);
    if (parsedPermissions.error) {
      return res.status(400).json({
        success: false,
        message: parsedPermissions.error,
      });
    }
    updates.permissions = parsedPermissions.permissions;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No updatable fields provided.',
    });
  }

  const nextName = updates.name || role.name;
  const nextSlug = updates.slug || role.slug;
  const conflictingRole = await EmployeeAccessRole.findOne({
    where: {
      id: { [Op.ne]: role.id },
      [Op.or]: [{ name: nextName }, { slug: nextSlug }],
    },
  });

  if (conflictingRole) {
    return res.status(409).json({
      success: false,
      message: 'Employee access role name or slug already exists.',
    });
  }

  await role.update(updates);

  return res.status(200).json({
    success: true,
    message: 'Employee access role updated successfully.',
    data: serializeEmployeeAccessRole(role),
  });
});

const deleteEmployeeAccessRole = asyncHandler(async (req, res) => {
  ensureAdmin(req, res);

  const role = await EmployeeAccessRole.findByPk(req.params.id);
  if (!role) {
    return res.status(404).json({
      success: false,
      message: 'Employee access role not found.',
    });
  }

  const assignedEmployeeCount = await User.count({
    where: {
      role: 'employee',
      employee_access_role_id: role.id,
    },
  });

  if (assignedEmployeeCount > 0) {
    return res.status(409).json({
      success: false,
      message: 'Cannot delete an employee access role that is assigned to employees.',
    });
  }

  await role.destroy();

  return res.status(200).json({
    success: true,
    message: 'Employee access role deleted successfully.',
  });
});

module.exports = {
  createEmployeeAccessRole,
  deleteEmployeeAccessRole,
  getEmployeeAccessRoleById,
  getEmployeeAccessRoleMeta,
  listEmployeeAccessRoles,
  updateEmployeeAccessRole,
};

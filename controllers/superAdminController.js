const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const { Op, fn, col } = require("sequelize");
const User = require("../models/User");
const Company = require("../models/Company");
const PosMachine = require("../models/posMachine");
const db = require("../config/database");

/**
 * Helper to decrypt or decode ID if sent in encrypted / encoded string format
 */
function tryDecryptId(rawId) {
  if (!rawId || typeof rawId !== "string") return rawId;
  const trimmed = rawId.trim();

  // Try project AES decryption helper
  try {
    const { decryptResponse } = require("../utils/encryption");
    const decrypted = decryptResponse(trimmed);
    if (decrypted) {
      if (typeof decrypted === "object" && decrypted.id) return decrypted.id;
      if (typeof decrypted === "string" || typeof decrypted === "number") return decrypted;
    }
  } catch (_) {}

  // Try standard base64 decoding
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (/^\d+$/.test(decoded)) {
      return Number(decoded);
    }
    if (decoded && decoded.length < 100 && !/[^\x20-\x7E]/.test(decoded)) {
      return decoded;
    }
  } catch (_) {}

  return trimmed;
}

/**
 * Locates an Admin User by numeric ID, encrypted/encoded string, abheepay_id, or username
 */
async function findAdminUser(identifier) {
  if (!identifier) return null;
  const resolved = tryDecryptId(identifier);

  const numericId = Number(resolved);
  if (Number.isFinite(numericId) && numericId > 0) {
    const user = await User.findOne({
      where: { id: numericId, role: "admin" },
      include: [{ model: Company, as: "company", required: false }],
    });
    if (user) return user;
  }

  const user = await User.findOne({
    where: {
      role: "admin",
      [Op.or]: [
        { abheepay_id: String(resolved) },
        { username: String(resolved) },
        { email: String(resolved) },
        { company_id: String(resolved) },
      ],
    },
    include: [{ model: Company, as: "company", required: false }],
  });

  return user;
}

/**
 * Enforces Super Admin access
 */
function checkSuperAdminAccess(req, res) {
  const role = req.user?.role;
  if (role !== "super_admin") {
    res.status(403);
    throw new Error("Access denied. Super Admin role required.");
  }
}

/**
 * GET /api/super-admin/getAllAdmins & GET /api/super-admin
 * List all admin users with pagination, search, status filter, and associated company data
 */
const getSuperAdminData = asyncHandler(async (req, res) => {
  checkSuperAdminAccess(req, res);

  const {
    page = 1,
    limit = 10,
    status,
    search,
    q,
  } = req.query;

  const searchTerm = (search || q || "").trim();
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const where = { role: "admin" };

  if (status) {
    where.status = status;
  }

  if (searchTerm) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${searchTerm}%` } },
      { email: { [Op.iLike]: `%${searchTerm}%` } },
      { username: { [Op.iLike]: `%${searchTerm}%` } },
      { mobile_number: { [Op.iLike]: `%${searchTerm}%` } },
      { abheepay_id: { [Op.iLike]: `%${searchTerm}%` } },
      { company_or_shop_name: { [Op.iLike]: `%${searchTerm}%` } },
    ];
  }

  const { count, rows: users } = await User.findAndCountAll({
    where,
    include: [
      {
        model: Company,
        as: "company",
        required: false,
      },
    ],
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
    order: [["createdAt", "DESC"]],
  });

  const userIds = users.map((u) => u.id);
  const posCounts = userIds.length
    ? await PosMachine.findAll({
        where: { assigned_to: userIds },
        attributes: ["assigned_to", [fn("COUNT", col("id")), "count"]],
        group: ["assigned_to"],
      })
    : [];

  const posCountMap = posCounts.reduce((acc, row) => {
    acc[row.assigned_to] = parseInt(row.get("count"), 10);
    return acc;
  }, {});

  const serializedUsers = users.map((u) => {
    const plain = u.toJSON ? u.toJSON() : { ...u };
    plain.pos_machine_count = posCountMap[plain.id] || 0;
    plain.wallet_balance = parseFloat(plain.wallet || 0);
    return plain;
  });

  res.status(200).json({
    success: true,
    message: "Admin users retrieved successfully",
    data: serializedUsers,
    pagination: {
      total: count,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(count / parseInt(limit, 10)),
    },
  });
});

/**
 * GET /api/super-admin/admin/:id & GET /api/super-admin/:id
 * Fetch single admin user details including company & assigned POS machines
 */
const getAdminDetails = asyncHandler(async (req, res) => {
  checkSuperAdminAccess(req, res);

  const { id } = req.params;
  const admin = await findAdminUser(id);

  if (!admin) {
    res.status(404);
    throw new Error("Admin user not found.");
  }

  const plain = admin.toJSON ? admin.toJSON() : { ...admin };
  const posMachines = await PosMachine.findAll({
    where: { assigned_to: admin.id },
  });

  plain.pos_machines = posMachines;
  plain.pos_machine_count = posMachines.length;
  plain.wallet_balance = parseFloat(plain.wallet || 0);

  res.status(200).json({
    success: true,
    message: "Admin details retrieved successfully",
    data: plain,
  });
});

/**
 * POST /api/super-admin/createAdmin & POST /api/super-admin/admin/create-admin & POST /api/super-admin
 * Super Admin creates Admin User and Company in one request
 */
const createSuperAdmin = asyncHandler(async (req, res) => {
  checkSuperAdminAccess(req, res);

  const {
    name,
    email,
    mobile_number,
    password,
    domain_name,
    company_name,
    company_or_shop_name,
    settlement_type = "today_settlement",
  } = req.body;

  const missingFields = [];
  if (!email) missingFields.push("email");
  if (!password) missingFields.push("password");
  if (!mobile_number) missingFields.push("mobile_number");
  if (!domain_name) missingFields.push("domain_name");

  if (missingFields.length > 0) {
    res.status(400);
    throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
  }

  const existingEmail = await User.findOne({ where: { email } });
  if (existingEmail) {
    res.status(409);
    throw new Error("A user with this email already exists.");
  }

  const cleanDomain = String(domain_name).trim().toLowerCase().replace(/^https?:\/\//, "");
  const existingDomain = await Company.findOne({ where: { domain_name: cleanDomain } });
  if (existingDomain) {
    res.status(409);
    throw new Error(`Domain '${cleanDomain}' is already registered to another company.`);
  }

  const hashPassword = await bcrypt.hash(password, 10);

  // Generate unique username with APA prefix
  const lastUser = await User.findOne({
    where: { role: "admin" },
    order: [["id", "DESC"]],
  });
  const nextNum = lastUser ? lastUser.id + 1 : 1;
  const username = `APA${String(nextNum).padStart(5, "0")}`;
  const companyId = `COMP_${Date.now()}`;
  const finalCompanyName = company_name || company_or_shop_name || `${name || "Admin"}'s Company`;

  const transaction = await db.transaction();

  try {
    const newUser = await User.create(
      {
        name: name || finalCompanyName,
        email,
        mobile_number,
        password: hashPassword,
        role: "admin",
        username,
        company_id: companyId,
        company_or_shop_name: finalCompanyName,
        settlement_type,
        status: "active",
      },
      { transaction }
    );

    const newCompany = await Company.create(
      {
        domain_name: cleanDomain,
        user_id: newUser.id,
        company_id: companyId,
        company_name: finalCompanyName,
        status: "active",
      },
      { transaction }
    );

    await transaction.commit();

    const plain = newUser.toJSON ? newUser.toJSON() : { ...newUser };
    delete plain.password;
    plain.company = newCompany;

    res.status(201).json({
      success: true,
      message: "Admin and Company created successfully",
      data: plain,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Create Admin error:", error);
    res.status(500);
    throw new Error(error.message || "Failed to create Admin and Company.");
  }
});

/**
 * PUT /api/super-admin/admin/:id & PUT /api/super-admin/:id
 * Update Admin user details & associated Company info
 */
const updateAdmin = asyncHandler(async (req, res) => {
  checkSuperAdminAccess(req, res);

  const { id } = req.params;
  const admin = await findAdminUser(id);

  if (!admin) {
    res.status(404);
    throw new Error("Admin user not found.");
  }

  const {
    name,
    email,
    mobile_number,
    status,
    company_name,
    company_or_shop_name,
    domain_name,
    password,
  } = req.body;

  if (name !== undefined) admin.name = name;
  if (email !== undefined) admin.email = email;
  if (mobile_number !== undefined) admin.mobile_number = mobile_number;
  if (status !== undefined) admin.status = status;
  if (company_or_shop_name !== undefined || company_name !== undefined) {
    admin.company_or_shop_name = company_name || company_or_shop_name;
  }

  if (password) {
    admin.password = await bcrypt.hash(password, 10);
  }

  await admin.save();

  if (admin.company_id && (company_name || domain_name || status)) {
    const company = await Company.findOne({ where: { company_id: admin.company_id } });
    if (company) {
      if (company_name) company.company_name = company_name;
      if (domain_name) {
        company.domain_name = String(domain_name).trim().toLowerCase().replace(/^https?:\/\//, "");
      }
      if (status) company.status = status;
      await company.save();
    }
  }

  const updatedAdmin = await findAdminUser(admin.id);
  const plain = updatedAdmin.toJSON ? updatedAdmin.toJSON() : { ...updatedAdmin };
  delete plain.password;

  res.status(200).json({
    success: true,
    message: "Admin updated successfully",
    data: plain,
  });
});

/**
 * PATCH /api/super-admin/admin/:id/status & PUT /api/super-admin/admin/:id/status & PUT /api/super-admin/:id/status
 * Toggle Admin user status (active, inactive, blocked)
 */
const updateAdminStatus = asyncHandler(async (req, res) => {
  checkSuperAdminAccess(req, res);

  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    res.status(400);
    throw new Error("Status is required.");
  }

  const admin = await findAdminUser(id);
  if (!admin) {
    res.status(404);
    throw new Error("Admin user not found.");
  }

  admin.status = status;
  await admin.save();

  if (admin.company_id) {
    await Company.update({ status }, { where: { company_id: admin.company_id } });
  }

  res.status(200).json({
    success: true,
    message: `Admin status updated to '${status}' successfully`,
    data: {
      id: admin.id,
      status: admin.status,
    },
  });
});

/**
 * GET /api/super-admin/inventory & GET /api/super-admin/getPosInventory
 * Get POS machines inventory for Super Admin
 */
const getSuperAdminPosInventory = asyncHandler(async (req, res) => {
  checkSuperAdminAccess(req, res);

  const {
    page = 1,
    limit = 50,
    status,
    search,
  } = req.query;

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const where = {};

  if (status) {
    where.status = status;
  }

  if (search) {
    const term = search.trim();
    where[Op.or] = [
      { pos_machine_id: { [Op.iLike]: `%${term}%` } },
      { serial_number: { [Op.iLike]: `%${term}%` } },
      { model_name: { [Op.iLike]: `%${term}%` } },
    ];
  }

  const { count, rows: machines } = await PosMachine.findAndCountAll({
    where,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
    order: [["createdAt", "DESC"]],
  });

  res.status(200).json({
    success: true,
    message: "POS inventory retrieved successfully",
    data: machines,
    pagination: {
      total: count,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(count / parseInt(limit, 10)),
    },
  });
});

module.exports = {
  getSuperAdminData,
  getAdminDetails,
  createSuperAdmin,
  updateAdmin,
  updateAdminStatus,
  getSuperAdminPosInventory,
};
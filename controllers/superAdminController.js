const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const { Op, fn, col } = require("sequelize");
const User = require("../models/User");
const Company = require("../models/Company");
const PosMachine = require("../models/posMachine");
const db = require("../config/database");
const UsernameSequence = require("../models/UsernameSequence");
const CompanyName = require("../models/CompanyName");

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
    mobile_number_country_code = "+91",
    password,
    domain_name,
    company_name,
    company_or_shop_name,
    company_id,
    settlement_type = "today_settlement",
    gender,
    dob,
    address1,
    address2,
    city,
    district,
    state,
    country = "India",
    pincode,
    aadhar_number,
    pan_number,
    gst_number,
    payout_limit,
    bill_payment_limit,
  } = req.body;

  console.log("Received createSuperAdmin request body:", req.body);

  // 1. Mandatory Fields Validation
  const finalCompanyName = String(company_name || company_or_shop_name || "").trim();
  const missingFields = [];
  if (!name || !String(name).trim()) missingFields.push("name");
  if (!email || !String(email).trim()) missingFields.push("email");
  if (!password || !String(password).trim()) missingFields.push("password");
  if (!mobile_number || !String(mobile_number).trim()) missingFields.push("mobile_number");
  if (!domain_name || !String(domain_name).trim()) missingFields.push("domain_name");
  if (!finalCompanyName) missingFields.push("company_name");

  if (missingFields.length > 0) {
    res.status(400);
    throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
  }

  // 2. Format Validations
  const cleanEmail = String(email).trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    res.status(400);
    throw new Error("Invalid email address format.");
  }

  const cleanMobile = String(mobile_number).replace(/\D/g, "").slice(-10);
  if (cleanMobile.length !== 10 || !/^[6-9]\d{9}$/.test(cleanMobile)) {
    res.status(400);
    throw new Error("Mobile number must be a valid 10-digit Indian mobile number.");
  }

  if (String(password).length < 8) {
    res.status(400);
    throw new Error("Password must be at least 8 characters long.");
  }

  const cleanDomain = String(domain_name)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!cleanDomain || cleanDomain.length < 3) {
    res.status(400);
    throw new Error("Invalid domain name format.");
  }

  const cleanAadhaar = aadhar_number ? String(aadhar_number).replace(/\D/g, "").slice(0, 12) : null;
  if (cleanAadhaar && cleanAadhaar.length !== 12) {
    res.status(400);
    throw new Error("Aadhaar number must contain exactly 12 digits.");
  }

  const cleanPan = pan_number ? String(pan_number).trim().toUpperCase() : null;
  if (cleanPan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(cleanPan)) {
    res.status(400);
    throw new Error("PAN number must be formatted as 5 letters, 4 digits, and 1 letter (e.g. ABCDE1234F).");
  }

  const cleanGst = gst_number ? String(gst_number).trim().toUpperCase() : null;
  if (cleanGst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(cleanGst)) {
    res.status(400);
    throw new Error("GST number must be a valid 15-character GSTIN format.");
  }

  const cleanPincode = pincode ? String(pincode).replace(/\D/g, "").slice(0, 6) : null;
  if (cleanPincode && cleanPincode.length !== 6) {
    res.status(400);
    throw new Error("Pincode must contain exactly 6 digits.");
  }

  const cleanCompanyId = company_id ? String(company_id).trim().toUpperCase() : null;
  if (cleanCompanyId && !/^[A-Z0-9_-]+$/.test(cleanCompanyId)) {
    res.status(400);
    throw new Error("Company ID must only contain uppercase letters, numbers, underscores, and hyphens.");
  }

  // 3. Uniqueness Pre-flight Checks
  if (cleanCompanyId) {
    const existingCompanyId = await Company.findOne({ where: { company_id: cleanCompanyId } });
    if (existingCompanyId) {
      res.status(409);
      throw new Error(`Company ID '${cleanCompanyId}' is already registered to another company.`);
    }
  }

  const existingEmail = await User.findOne({ where: { email: cleanEmail } });
  if (existingEmail) {
    res.status(409);
    throw new Error("A user with this email already exists.");
  }

  const existingMobile = await User.findOne({ where: { mobile_number: cleanMobile } });
  if (existingMobile) {
    res.status(409);
    throw new Error("A user with this mobile number already exists.");
  }

  const existingDomain = await Company.findOne({ where: { domain_name: cleanDomain } });
  if (existingDomain) {
    res.status(409);
    throw new Error(`Domain '${cleanDomain}' is already registered to another company.`);
  }

  if (cleanAadhaar) {
    const existingAadhaar = await User.findOne({ where: { aadhar_number: cleanAadhaar } });
    if (existingAadhaar) {
      res.status(409);
      throw new Error("A user with this Aadhaar number already exists.");
    }
  }

  if (cleanPan) {
    const existingPan = await User.findOne({ where: { pan_number: cleanPan } });
    if (existingPan) {
      res.status(409);
      throw new Error("A user with this PAN number already exists.");
    }
  }

  // 4. KYC Document Uploads to Cloudinary (mimicking franchise KYC flow)
  const panFile = req.files?.pan_photo;
  const aadharFile = req.files?.aadhar_photo;
  const aadharBkFile = req.files?.aadhar_back_photo;
  const shopFile = req.files?.shop_photo;
  const bankPassbookFile = req.files?.bank_passbook;

  let panUrl = null;
  let aadharUrl = null;
  let aadharBkUrl = null;
  let shopUrl = null;
  let bankPassbookUrl = null;

  try {
    const uploadPromises = [
      panFile ? cloudinary.uploader.upload(panFile.tempFilePath, { folder: "admin_kyc" }) : null,
      aadharFile ? cloudinary.uploader.upload(aadharFile.tempFilePath, { folder: "admin_kyc" }) : null,
      aadharBkFile ? cloudinary.uploader.upload(aadharBkFile.tempFilePath, { folder: "admin_kyc" }) : null,
      shopFile ? cloudinary.uploader.upload(shopFile.tempFilePath, { folder: "admin_kyc" }) : null,
      bankPassbookFile ? cloudinary.uploader.upload(bankPassbookFile.tempFilePath, { folder: "admin_kyc" }) : null,
    ];
    [panUrl, aadharUrl, aadharBkUrl, shopUrl, bankPassbookUrl] = await Promise.all(uploadPromises);
  } catch (uploadErr) {
    console.error("KYC Document upload error:", uploadErr);
    res.status(500);
    throw new Error(`Failed to upload KYC documents: ${uploadErr.message}`);
  }

  const hashPassword = await bcrypt.hash(password, 10);
  const companyId = cleanCompanyId || `COMP_${Date.now()}`;

  // 5. ATOMIC 3-TABLE TRANSACTION (Users, Companies, company_names)
  const transaction = await db.transaction();

  try {
    // 5a. Allocate consecutive APA username using UsernameSequence with DB row lock
    const [seq] = await UsernameSequence.findOrCreate({
      where: { prefix: "APA" },
      defaults: { current_value: 0 },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    let nextVal = Number(seq.current_value) || 0;
    let username;
    while (true) {
      nextVal += 1;
      username = `APA${String(nextVal).padStart(5, "0")}`;
      const exists = await User.findOne({
        where: { username },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!exists) {
        seq.current_value = nextVal;
        await seq.save({ transaction });
        break;
      }
    }

    // 5b. Step 1: Create in Users table (company_id: null initially to satisfy Companies.user_id FK)
    const newUser = await User.create(
      {
        name: String(name).trim(),
        email: cleanEmail,
        mobile_number: cleanMobile,
        mobile_number_country_code: String(mobile_number_country_code || "+91").trim(),
        password: hashPassword,
        role: "admin",
        username,
        abheepay_id: username,
        gender: gender || null,
        dob: dob || null,
        address1: address1 || null,
        address2: address2 || null,
        city: city || null,
        district: district || null,
        state: state || null,
        country: country || "India",
        pincode: cleanPincode || null,
        aadhar_number: cleanAadhaar || null,
        pan_number: cleanPan || null,
        pan_number_url: panUrl?.secure_url || null,
        aadhar_number_url: aadharUrl?.secure_url || null,
        aadhar_back_number_url: aadharBkUrl?.secure_url || null,
        shop_with_photo_url: shopUrl?.secure_url || null,
        bank_passbook_url: bankPassbookUrl?.secure_url || null,
        cleanCompanyId,
        company_or_shop_name: finalCompanyName,
        settlement_type: settlement_type || "today_settlement",
        status: "active",
        is_approved: true,
      },
      { transaction }
    );

    // 5c. Step 2: Create in Companies table (mapped to newUser.id and companyId)
    const newCompany = await Company.create(
      {
        domain_name: cleanDomain,
        user_id: newUser.id,
        company_id: companyId,
        company_name: finalCompanyName,
        director_name: String(name).trim() || finalCompanyName,
        email: cleanEmail,
        mobile_number: cleanMobile,
        address1: address1 || null,
        address2: address2 || null,
        city: city || null,
        district: district || null,
        state: state || null,
        country: country || "India",
        pincode: cleanPincode || null,
        pan_number: cleanPan || null,
        gst_number: cleanGst || null,
        payout_limit: payout_limit ? Number(payout_limit) : 0,
        bill_payment_limit: bill_payment_limit ? Number(bill_payment_limit) : 0,
        status: "active",
      },
      { transaction }
    );

    // 5d. Step 3: Link User with company_id now that Company is created
    newUser.company_id = companyId;
    await newUser.save({ transaction });

    // 5e. Step 4: Create or link in company_names table (CompanyName model)
    const [companyNameRecord] = await CompanyName.findOrCreate({
      where: { name: finalCompanyName },
      defaults: {
        name: finalCompanyName,
        created_by: req.user?.id || newUser.id,
        updated_by: req.user?.id || newUser.id,
      },
      transaction,
    });

    // 5f. Commit all 3 tables atomically
    await transaction.commit();

    const plain = newUser.toJSON ? newUser.toJSON() : { ...newUser };
    delete plain.password;
    plain.company = newCompany;
    plain.company_name = companyNameRecord;

    res.status(201).json({
      success: true,
      message: "Admin user, Company, and Company Name created and mapped successfully",
      data: plain,
    });
  } catch (error) {
    // If any step fails, rollback EVERYTHING (all 3 tables)
    await transaction.rollback();
    console.error("Create Admin transaction error (rolled back):", error);
    res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);
    throw new Error(error.message || "Failed to create Admin, Company, and Company Name records.");
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
    gender,
    dob,
    address1,
    address2,
    city,
    district,
    state,
    country,
    pincode,
    aadhar_number,
    pan_number,
    gst_number,
    settlement_type,
    status,
    company_name,
    company_or_shop_name,
    domain_name,
    password,
  } = req.body;

  const finalCompanyName = company_name || company_or_shop_name;

  if (name !== undefined) admin.name = name;
  if (email !== undefined) admin.email = email;
  if (mobile_number !== undefined) admin.mobile_number = mobile_number;
  if (gender !== undefined) admin.gender = gender;
  if (dob !== undefined) admin.dob = dob;
  if (address1 !== undefined) admin.address1 = address1;
  if (address2 !== undefined) admin.address2 = address2;
  if (city !== undefined) admin.city = city;
  if (district !== undefined) admin.district = district;
  if (state !== undefined) admin.state = state;
  if (country !== undefined) admin.country = country;
  if (pincode !== undefined) admin.pincode = pincode;
  if (aadhar_number !== undefined) admin.aadhar_number = aadhar_number;
  if (pan_number !== undefined) admin.pan_number = pan_number;
  if (settlement_type !== undefined) admin.settlement_type = settlement_type;
  if (status !== undefined) admin.status = status;
  if (finalCompanyName !== undefined) {
    admin.company_or_shop_name = finalCompanyName;
  }

  if (password && String(password).trim().length >= 8) {
    admin.password = await bcrypt.hash(password, 10);
  }

  await admin.save();

  if (admin.company_id) {
    const company = await Company.findOne({ where: { company_id: admin.company_id } });
    if (company) {
      if (finalCompanyName) company.company_name = finalCompanyName;
      if (name) company.director_name = name;
      if (email) company.email = email;
      if (mobile_number) company.mobile_number = mobile_number;
      if (address1 !== undefined) company.address1 = address1;
      if (address2 !== undefined) company.address2 = address2;
      if (city !== undefined) company.city = city;
      if (district !== undefined) company.district = district;
      if (state !== undefined) company.state = state;
      if (country !== undefined) company.country = country;
      if (pincode !== undefined) company.pincode = pincode;
      if (pan_number !== undefined) company.pan_number = pan_number;
      if (gst_number !== undefined) company.gst_number = gst_number;
      if (domain_name) {
        company.domain_name = String(domain_name).trim().toLowerCase().replace(/^https?:\/\//, "");
      }
      if (status) company.status = status;
      await company.save();
    }

    if (finalCompanyName) {
      await CompanyName.findOrCreate({
        where: { name: finalCompanyName },
        defaults: {
          name: finalCompanyName,
          created_by: req.user?.id || admin.id,
          updated_by: req.user?.id || admin.id,
        },
      });
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
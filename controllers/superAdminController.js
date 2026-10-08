const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const { Op, fn, col } = require("sequelize");
const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const User = require("../models/User");
const Company = require("../models/Company");
const PosMachine = require("../models/posMachine");
const RazorpayNotification = require("../models/RazorpayNotification");
const MerchantTransactionCharge = require("../models/MerchantTransactionCharge");
const db = require("../config/database");
const UsernameSequence = require("../models/UsernameSequence");
const CompanyName = require("../models/CompanyName");
const ServiceSetting = require("../models/ServiceSetting");
const { parseIstBusinessDateRange } = require("../utils/dateRange");

// Configure Cloudinary if environment variables are provided
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/**
 * Strips protocol (http:// or https://), leading www., port, path, query, hash.
 * E.g. "https://www.google.com/path" -> "google.com"
 * E.g. "www.google.com" -> "google.com"
 */
function sanitizeDomainName(rawDomain) {
  if (!rawDomain) return "";
  let domain = String(rawDomain).trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//i, "");
  domain = domain.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  domain = domain.replace(/^www\./i, "");
  return domain.trim();
}

/**
 * Resilient file upload helper:
 * 1. Attempts Cloudinary upload if credentials exist and file tempFilePath exists.
 * 2. If Cloudinary is not configured or upload fails, saves file locally under uploads/<folder>/
 *    and returns the accessible URL path (e.g. /uploads/<folder>/<filename>).
 */
async function uploadOrSaveFile(file, folder = "uploads") {
  if (!file) return null;

  // 1. Try Cloudinary if keys exist
  if (process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_CLOUD_NAME) {
    try {
      const uploadPath = file.tempFilePath || file.path;
      if (uploadPath && fs.existsSync(uploadPath)) {
        const result = await cloudinary.uploader.upload(uploadPath, { folder });
        if (result?.secure_url) {
          return result.secure_url;
        }
      }
    } catch (cErr) {
      console.warn(`[Cloudinary Warning] Upload to ${folder} failed, falling back to local disk:`, cErr.message || cErr);
    }
  }

  // 2. Safe local storage fallback in uploads/<folder>
  try {
    const targetDir = path.join(__dirname, "..", "uploads", folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const orig = file.name || "file";
    const ext = path.extname(orig) || ".png";
    const cleanName = path
      .basename(orig, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 30);
    const filename = `${Date.now()}_${cleanName}${ext}`;
    const destination = path.join(targetDir, filename);

    if (file.tempFilePath && fs.existsSync(file.tempFilePath)) {
      fs.copyFileSync(file.tempFilePath, destination);
    } else if (file.data) {
      fs.writeFileSync(destination, file.data);
    } else if (typeof file.mv === "function") {
      await file.mv(destination);
    } else {
      return null;
    }

    return `/uploads/${folder}/${filename}`;
  } catch (localErr) {
    console.error(`[Local File Save Error] Could not save file into ${folder}:`, localErr);
    return null;
  }
}

/**
 * Deletes an array of locally saved files (by relative URL /uploads/... or absolute path)
 * if any database transaction or validation fails, preventing orphaned files on disk.
 */
function deleteLocalFiles(filePaths = []) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return;
  for (const fp of filePaths) {
    if (!fp || typeof fp !== "string") continue;
    try {
      let diskPath = fp;
      if (fp.startsWith("/uploads/") || fp.startsWith("uploads/")) {
        const relativePart = fp.replace(/^\//, "");
        diskPath = path.join(__dirname, "..", relativePart);
      }
      if (fs.existsSync(diskPath)) {
        fs.unlinkSync(diskPath);
        console.log(`[File Cleanup] Deleted orphaned file on error: ${diskPath}`);
      }
    } catch (delErr) {
      console.warn(`[File Cleanup Warning] Could not remove file ${fp}:`, delErr.message || delErr);
    }
  }
}

/**
 * Generates an uppercase unique companyId (e.g. COMP_GOOGLE_01) checked against DB within transaction.
 */
async function generateUniqueCompanyId(companyName, cleanCompanyId, transaction) {
  if (cleanCompanyId) {
    return cleanCompanyId;
  }

  const baseSlug = String(companyName || "COMP")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 15) || "COMP";

  const prefix = baseSlug.startsWith("COMP_") ? baseSlug : `COMP_${baseSlug}`;

  let candidate = prefix;
  let counter = 1;
  while (true) {
    const exists = await Company.findOne({
      where: { company_id: candidate },
      transaction,
    });
    if (!exists) {
      return candidate;
    }
    candidate = `${prefix}_${String(counter).padStart(2, "0")}`;
    counter++;
  }
}

/**
 * Helper to decrypt or decode ID if sent in encrypted / encoded string format
 */
function tryDecryptId(rawId) {
  if (!rawId) return rawId;
  let trimmed = String(rawId).trim();
  try {
    trimmed = decodeURIComponent(trimmed).trim();
  } catch (_) {}

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
      where: {
        id: numericId,
        role: { [Op.in]: ["admin", "super_admin", "Admin", "SUPER_ADMIN"] },
      },
      include: [{ model: Company, as: "company", required: false }],
    });
    if (user) return user;

    // Fallback: search by PK directly
    const fallbackUser = await User.findByPk(numericId, {
      include: [{ model: Company, as: "company", required: false }],
    });
    if (fallbackUser) return fallbackUser;
  }

  const user = await User.findOne({
    where: {
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

  const cleanDomain = sanitizeDomainName(domain_name);
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

  // 4. KYC & Company Logo Document Uploads (with local disk fallback if Cloudinary is unavailable)
  const panFile = req.files?.pan_photo;
  const aadharFile = req.files?.aadhar_photo;
  const aadharBkFile = req.files?.aadhar_back_photo;
  const shopFile = req.files?.shop_photo;
  const bankPassbookFile = req.files?.bank_passbook;
  const companyLogoFile = req.files?.company_logo;

  let panUrl = null;
  let aadharUrl = null;
  let aadharBkUrl = null;
  let shopUrl = null;
  let bankPassbookUrl = null;
  let logoUrl = null;

  const uploadedLocalFiles = [];

  try {
    const [panRes, aadharRes, aadharBkRes, shopRes, bankRes, logoRes] = await Promise.all([
      panFile ? uploadOrSaveFile(panFile, "admin_kyc") : null,
      aadharFile ? uploadOrSaveFile(aadharFile, "admin_kyc") : null,
      aadharBkFile ? uploadOrSaveFile(aadharBkFile, "admin_kyc") : null,
      shopFile ? uploadOrSaveFile(shopFile, "admin_kyc") : null,
      bankPassbookFile ? uploadOrSaveFile(bankPassbookFile, "admin_kyc") : null,
      companyLogoFile ? uploadOrSaveFile(companyLogoFile, "company_logos") : null,
    ]);
    panUrl = panRes;
    aadharUrl = aadharRes;
    aadharBkUrl = aadharBkRes;
    shopUrl = shopRes;
    bankPassbookUrl = bankRes;
    logoUrl = logoRes;

    [panUrl, aadharUrl, aadharBkUrl, shopUrl, bankPassbookUrl, logoUrl].forEach((u) => {
      if (u && typeof u === "string" && (u.startsWith("/uploads/") || u.startsWith("uploads/"))) {
        uploadedLocalFiles.push(u);
      }
    });
  } catch (uploadErr) {
    console.warn("KYC / Logo upload warning:", uploadErr);
  }

  const hashPassword = await bcrypt.hash(password, 10);

  // 5. ATOMIC 3-TABLE TRANSACTION (Users, Companies, company_names)
  const transaction = await db.transaction();

  try {
    // Generate unique company_id within transaction (e.g. COMP_GOOGLE_01)
    const companyId = await generateUniqueCompanyId(finalCompanyName, cleanCompanyId, transaction);

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

    // 5b. Step 1: Create in Users table (company_id: null initially to satisfy Users_company_id_fkey before Company exists)
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
        pan_number_url: panUrl || null,
        aadhar_number_url: aadharUrl || null,
        aadhar_back_number_url: aadharBkUrl || null,
        shop_with_photo_url: logoUrl || shopUrl || null,
        bank_passbook_url: bankPassbookUrl || null,
        company_id: null,
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
        company_logo: logoUrl || null,
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

    // 5d. Step 3: Link User with company_id now that Company record exists in database
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

    // Clean up any locally created files so no orphaned files remain on disk
    deleteLocalFiles(uploadedLocalFiles);

    console.error("Create Admin transaction error (rolled back):", error);
    res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);
    throw new Error(error.message || "Failed to create Admin, Company, and Company Name records.");
  }
});

/**
 * PUT /api/super-admin/admin/:id & PUT /api/super-admin/:id
 * Surgically update ONLY the provided and changed fields on Admin and Company
 */
const updateAdmin = asyncHandler(async (req, res) => {
  checkSuperAdminAccess(req, res);

  const { id } = req.params;
  const admin = await findAdminUser(id);

  if (!admin) {
    res.status(404);
    throw new Error("Admin user not found.");
  }

  // Resolve associated company if present
  let company = admin.company || null;
  if (!company && admin.company_id) {
    company = await Company.findOne({ where: { company_id: admin.company_id } });
  }
  if (!company) {
    company = await Company.findOne({ where: { user_id: admin.id } });
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
    payout_limit,
    bill_payment_limit,
    t0_daily_limit,
  } = req.body;

  const uploadedLocalFiles = [];
  const userUpdates = {};
  const companyUpdates = {};

  // 1. SURGICAL USER DIFF CHECKS (only update if provided and different from DB)
  if (name !== undefined && name !== null && String(name).trim() && String(name).trim() !== (admin.name || "")) {
    userUpdates.name = String(name).trim();
  }

  if (email !== undefined && email !== null && String(email).trim()) {
    const cleanEmail = String(email).trim().toLowerCase();
    if (cleanEmail !== (admin.email || "").toLowerCase()) {
      const emailConflict = await User.findOne({
        where: { email: cleanEmail, id: { [Op.ne]: admin.id } },
      });
      if (emailConflict) {
        res.status(409);
        throw new Error(`Email '${cleanEmail}' is already registered to another user.`);
      }
      userUpdates.email = cleanEmail;
    }
  }

  if (mobile_number !== undefined && mobile_number !== null && String(mobile_number).trim()) {
    const cleanMobile = String(mobile_number).replace(/\D/g, "").slice(-10);
    if (cleanMobile.length === 10 && cleanMobile !== (admin.mobile_number || "")) {
      const mobileConflict = await User.findOne({
        where: { mobile_number: cleanMobile, id: { [Op.ne]: admin.id } },
      });
      if (mobileConflict) {
        res.status(409);
        throw new Error(`Mobile number '${cleanMobile}' is already registered to another user.`);
      }
      userUpdates.mobile_number = cleanMobile;
    }
  }

  if (gender !== undefined && gender !== null && String(gender).trim() && String(gender).trim() !== (admin.gender || "")) {
    userUpdates.gender = String(gender).trim();
  }

  if (dob !== undefined && dob !== null && dob !== "" && dob !== "null") {
    const parsedDob = new Date(dob);
    if (!isNaN(parsedDob.getTime())) {
      const existingDobStr = admin.dob ? new Date(admin.dob).toISOString().slice(0, 10) : "";
      const newDobStr = parsedDob.toISOString().slice(0, 10);
      if (newDobStr !== existingDobStr) {
        userUpdates.dob = parsedDob;
      }
    }
  }

  if (address1 !== undefined && address1 !== null && String(address1).trim() && String(address1).trim() !== (admin.address1 || "")) {
    userUpdates.address1 = String(address1).trim();
  }
  if (address2 !== undefined && address2 !== null && String(address2).trim() && String(address2).trim() !== (admin.address2 || "")) {
    userUpdates.address2 = String(address2).trim();
  }
  if (city !== undefined && city !== null && String(city).trim() && String(city).trim() !== (admin.city || "")) {
    userUpdates.city = String(city).trim();
  }
  if (district !== undefined && district !== null && String(district).trim() && String(district).trim() !== (admin.district || "")) {
    userUpdates.district = String(district).trim();
  }
  if (state !== undefined && state !== null && String(state).trim() && String(state).trim() !== (admin.state || "")) {
    userUpdates.state = String(state).trim();
  }
  if (country !== undefined && country !== null && String(country).trim() && String(country).trim() !== (admin.country || "")) {
    userUpdates.country = String(country).trim();
  }
  if (pincode !== undefined && pincode !== null && String(pincode).trim()) {
    const cleanPin = String(pincode).replace(/\D/g, "").slice(0, 6);
    if (cleanPin && cleanPin !== (admin.pincode || "")) {
      userUpdates.pincode = cleanPin;
    }
  }

  if (aadhar_number !== undefined && aadhar_number !== null && String(aadhar_number).trim()) {
    const cleanAadhaar = String(aadhar_number).replace(/\D/g, "").slice(0, 12);
    if (cleanAadhaar && cleanAadhaar !== (admin.aadhar_number || "")) {
      const aadharConflict = await User.findOne({
        where: { aadhar_number: cleanAadhaar, id: { [Op.ne]: admin.id } },
      });
      if (aadharConflict) {
        res.status(409);
        throw new Error("A user with this Aadhaar number already exists.");
      }
      userUpdates.aadhar_number = cleanAadhaar;
    }
  }

  if (pan_number !== undefined && pan_number !== null && String(pan_number).trim()) {
    const cleanPan = String(pan_number).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10);
    if (cleanPan && cleanPan !== (admin.pan_number || "")) {
      userUpdates.pan_number = cleanPan;
    }
  }

  const finalCompanyName = String(company_name || company_or_shop_name || "").trim();
  if (finalCompanyName && finalCompanyName !== (admin.company_or_shop_name || "")) {
    userUpdates.company_or_shop_name = finalCompanyName;
  }

  if (settlement_type !== undefined && settlement_type !== null && settlement_type !== admin.settlement_type) {
    if (["T0", "T1", "today_settlement", "next_day_settlement"].includes(settlement_type)) {
      userUpdates.settlement_type = settlement_type;
    }
  }

  if (t0_daily_limit !== undefined && t0_daily_limit !== null) {
    const parsedLimit = t0_daily_limit === "" ? null : Number(t0_daily_limit);
    if (!isNaN(parsedLimit)) {
      userUpdates.t0_daily_limit = parsedLimit;
    }
  }

  if (status !== undefined && status !== null && String(status).trim() && status !== admin.status) {
    userUpdates.status = status;
  }

  if (password && typeof password === "string" && password.trim().length >= 8) {
    userUpdates.password = await bcrypt.hash(password.trim(), 10);
  }

  // File uploads
  let newLogoUrl = null;
  if (req.files?.company_logo) {
    const logoRes = await uploadOrSaveFile(req.files.company_logo, "company_logos");
    if (logoRes) {
      newLogoUrl = logoRes;
      if (typeof logoRes === "string" && (logoRes.startsWith("/uploads/") || logoRes.startsWith("uploads/"))) {
        uploadedLocalFiles.push(logoRes);
      }
      userUpdates.shop_with_photo_url = logoRes;
    }
  } else if (req.body.company_logo && typeof req.body.company_logo === "string" && req.body.company_logo !== admin.shop_with_photo_url) {
    newLogoUrl = req.body.company_logo;
    userUpdates.shop_with_photo_url = req.body.company_logo;
  }

  if (req.files?.pan_card) {
    const res = await uploadOrSaveFile(req.files.pan_card, "admin_kyc");
    if (res) {
      if (typeof res === "string" && (res.startsWith("/uploads/") || res.startsWith("uploads/"))) uploadedLocalFiles.push(res);
      userUpdates.pan_number_url = res;
    }
  }
  if (req.files?.aadhar_front) {
    const res = await uploadOrSaveFile(req.files.aadhar_front, "admin_kyc");
    if (res) {
      if (typeof res === "string" && (res.startsWith("/uploads/") || res.startsWith("uploads/"))) uploadedLocalFiles.push(res);
      userUpdates.aadhar_number_url = res;
    }
  }
  if (req.files?.aadhar_back) {
    const res = await uploadOrSaveFile(req.files.aadhar_back, "admin_kyc");
    if (res) {
      if (typeof res === "string" && (res.startsWith("/uploads/") || res.startsWith("uploads/"))) uploadedLocalFiles.push(res);
      userUpdates.aadhar_back_number_url = res;
    }
  }
  if (req.files?.bank_passbook) {
    const res = await uploadOrSaveFile(req.files.bank_passbook, "admin_kyc");
    if (res) {
      if (typeof res === "string" && (res.startsWith("/uploads/") || res.startsWith("uploads/"))) uploadedLocalFiles.push(res);
      userUpdates.bank_passbook_url = res;
    }
  }
  if (req.files?.shop_with_photo) {
    const res = await uploadOrSaveFile(req.files.shop_with_photo, "admin_kyc");
    if (res) {
      if (typeof res === "string" && (res.startsWith("/uploads/") || res.startsWith("uploads/"))) uploadedLocalFiles.push(res);
      userUpdates.shop_with_photo_url = res;
    }
  }

  // 2. SURGICAL COMPANY DIFF CHECKS
  if (company) {
    if (finalCompanyName && finalCompanyName !== (company.company_name || "")) {
      companyUpdates.company_name = finalCompanyName;
    }
    if (userUpdates.name && userUpdates.name !== (company.director_name || "")) {
      companyUpdates.director_name = userUpdates.name;
    } else if (name !== undefined && name !== null && String(name).trim() && String(name).trim() !== (company.director_name || "")) {
      companyUpdates.director_name = String(name).trim();
    }
    if (userUpdates.email && userUpdates.email !== (company.email || "")) {
      companyUpdates.email = userUpdates.email;
    }
    if (userUpdates.mobile_number && userUpdates.mobile_number !== (company.mobile_number || "")) {
      companyUpdates.mobile_number = userUpdates.mobile_number;
    }
    if (userUpdates.address1 && userUpdates.address1 !== (company.address1 || "")) {
      companyUpdates.address1 = userUpdates.address1;
    }
    if (userUpdates.address2 && userUpdates.address2 !== (company.address2 || "")) {
      companyUpdates.address2 = userUpdates.address2;
    }
    if (userUpdates.city && userUpdates.city !== (company.city || "")) {
      companyUpdates.city = userUpdates.city;
    }
    if (userUpdates.district && userUpdates.district !== (company.district || "")) {
      companyUpdates.district = userUpdates.district;
    }
    if (userUpdates.state && userUpdates.state !== (company.state || "")) {
      companyUpdates.state = userUpdates.state;
    }
    if (userUpdates.country && userUpdates.country !== (company.country || "")) {
      companyUpdates.country = userUpdates.country;
    }
    if (userUpdates.pincode && userUpdates.pincode !== (company.pincode || "")) {
      companyUpdates.pincode = userUpdates.pincode;
    }
    if (userUpdates.pan_number && userUpdates.pan_number !== (company.pan_number || "")) {
      companyUpdates.pan_number = userUpdates.pan_number;
    }
    if (gst_number !== undefined && gst_number !== null && String(gst_number).trim()) {
      const cleanGst = String(gst_number).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 15);
      if (cleanGst && cleanGst !== (company.gst_number || "")) {
        companyUpdates.gst_number = cleanGst;
      }
    }
    if (newLogoUrl && newLogoUrl !== (company.company_logo || "")) {
      companyUpdates.company_logo = newLogoUrl;
    }
    if (userUpdates.status && userUpdates.status !== company.status) {
      companyUpdates.status = userUpdates.status;
    }

    if (payout_limit !== undefined && payout_limit !== null) {
      const parsedPayout = Number(payout_limit);
      if (!isNaN(parsedPayout)) {
        companyUpdates.payout_limit = parsedPayout;
      }
    }

    if (bill_payment_limit !== undefined && bill_payment_limit !== null) {
      const parsedBill = Number(bill_payment_limit);
      if (!isNaN(parsedBill)) {
        companyUpdates.bill_payment_limit = parsedBill;
      }
    }

    if (domain_name && String(domain_name).trim()) {
      const cleanDomain = sanitizeDomainName(domain_name);
      if (cleanDomain && cleanDomain !== (company.domain_name || "")) {
        const domainConflict = await Company.findOne({
          where: { domain_name: cleanDomain, id: { [Op.ne]: company.id } },
        });
        if (domainConflict) {
          res.status(409);
          throw new Error(`Domain '${cleanDomain}' is already registered to another company.`);
        }
        companyUpdates.domain_name = cleanDomain;
      }
    }
  }

  // 3. ATOMICALLY APPLY ONLY NECESSARY UPDATES
  const hasUserUpdates = Object.keys(userUpdates).length > 0;
  const hasCompanyUpdates = company && Object.keys(companyUpdates).length > 0;

  if (hasUserUpdates || hasCompanyUpdates) {
    const transaction = await db.transaction();
    try {
      if (hasUserUpdates) {
        await User.update(userUpdates, {
          where: { id: admin.id },
          transaction,
        });
      }

      if (hasCompanyUpdates) {
        await Company.update(companyUpdates, {
          where: { id: company.id },
          transaction,
        });
      }

      if (companyUpdates.company_name || userUpdates.company_or_shop_name) {
        const targetCompName = companyUpdates.company_name || userUpdates.company_or_shop_name;
        await CompanyName.findOrCreate({
          where: { name: targetCompName },
          defaults: {
            name: targetCompName,
            created_by: req.user?.id || admin.id,
            updated_by: req.user?.id || admin.id,
          },
          transaction,
        });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      deleteLocalFiles(uploadedLocalFiles);
      console.error("Update Admin transaction error (rolled back):", error);
      res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);
      throw new Error(error.message || "Failed to update Admin records.");
    }
  }

  // 4. Return fresh admin data
  const reloadedAdmin = await findAdminUser(admin.id);
  const plain = reloadedAdmin.toJSON ? reloadedAdmin.toJSON() : { ...reloadedAdmin };
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

  await Company.update(
    { status },
    {
      where: {
        [Op.or]: [
          { user_id: admin.id },
          ...(admin.company_id ? [{ company_id: admin.company_id }] : []),
        ],
      },
    }
  );

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

/**
 * GET /api/super-admin/reports/transactions
 * Super Admin Transaction Report
 */
const getSuperAdminTransactionReport = asyncHandler(async (req, res) => {
  checkSuperAdminAccess(req, res);

  const {
    page = 1,
    limit = 10,
    domain,
    company_id,
    from_date,
    to_date,
    status,
    search,
    q,
  } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;
  const searchTerm = (search || q || "").trim();

  const where = {};

  // Company / Domain filter
  let resolvedCompanyId = company_id;
  if (!resolvedCompanyId && domain) {
    const comp = await Company.findOne({
      where: {
        [Op.or]: [
          { domain_name: domain },
          { domain_name: { [Op.iLike]: `%${domain}%` } },
        ],
      },
    });
    if (comp) {
      resolvedCompanyId = comp.company_id;
    }
  }

  if (resolvedCompanyId) {
    where.company_id = resolvedCompanyId;
  }

  // Date range filter
  if (from_date || to_date) {
    const range = parseIstBusinessDateRange(from_date, to_date, { defaultToToday: false });
    if (range.error) {
      return res.status(400).json({ success: false, message: range.error });
    }
    if (range.fromDate && range.toDate) {
      where.createdAt = { [Op.between]: [range.fromDate, range.toDate] };
    } else if (range.fromDate) {
      where.createdAt = { [Op.gte]: range.fromDate };
    } else if (range.toDate) {
      where.createdAt = { [Op.lte]: range.toDate };
    }
  }

  // Status filter
  if (status) {
    where.status = status;
  }

  // Keyword search
  if (searchTerm) {
    const matchingUsers = await User.findAll({
      where: {
        [Op.or]: [
          { name: { [Op.iLike]: `%${searchTerm}%` } },
          { email: { [Op.iLike]: `%${searchTerm}%` } },
          { mobile_number: { [Op.iLike]: `%${searchTerm}%` } },
          { abheepay_id: { [Op.iLike]: `%${searchTerm}%` } },
        ],
      },
      attributes: ["id"],
      limit: 50,
    });
    const userIds = matchingUsers.map((u) => u.id);

    where[Op.or] = [
      { txn_id: { [Op.iLike]: `%${searchTerm}%` } },
      { rr_number: { [Op.iLike]: `%${searchTerm}%` } },
      ...(userIds.length > 0 ? [{ user_id: { [Op.in]: userIds } }] : []),
    ];
  }

  const { count, rows } = await RazorpayNotification.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: limitNum,
    offset,
    include: [
      {
        model: User,
        as: "user",
        required: false,
        attributes: ["id", "name", "email", "mobile_number", "abheepay_id", "company_id"],
      },
      {
        model: PosMachine,
        as: "posMachine",
        required: false,
        attributes: ["id", "mid_number", "tid_number", "device_serial_number"],
      },
    ],
  });

  // Fetch unique company details for the returned rows
  const companyIds = [...new Set(rows.map((r) => r.company_id || r.user?.company_id).filter(Boolean))];
  const companies = companyIds.length
    ? await Company.findAll({
        where: { company_id: { [Op.in]: companyIds } },
        attributes: ["company_id", "company_name", "domain_name"],
      })
    : [];
  const companyMap = new Map(companies.map((c) => [c.company_id, c]));

  // Calculate summary metrics
  const allMatching = await RazorpayNotification.findAll({
    where,
    attributes: ["amount", "status"],
  });

  let totalVolume = 0;
  let successCount = 0;
  let failedCount = 0;

  for (const item of allMatching) {
    const amt = parseFloat(item.amount) || 0;
    totalVolume += amt;
    const st = String(item.status || "").toLowerCase();
    if (st === "completed" || st === "success" || st === "captured") {
      successCount++;
    } else if (st === "failed") {
      failedCount++;
    }
  }

  const formattedRows = rows.map((r) => {
    const compId = r.company_id || r.user?.company_id || null;
    const comp = compId ? companyMap.get(compId) || null : null;

    return {
      id: r.id,
      txn_id: r.txn_id,
      rr_number: r.rr_number,
      amount: parseFloat(r.amount) || 0,
      status: r.status,
      payment_method: r.payment_method,
      card_type: r.card_type,
      card_network: r.card_network,
      created_at: r.createdAt || r.created_at,
      company: comp
        ? {
            company_id: comp.company_id,
            company_name: comp.company_name,
            domain_name: comp.domain_name,
          }
        : compId
        ? { company_id: compId, company_name: compId, domain_name: "-" }
        : null,
      merchant: r.user
        ? {
            id: r.user.id,
            name: r.user.name,
            email: r.user.email,
            mobile_number: r.user.mobile_number,
            abheepay_id: r.user.abheepay_id,
          }
        : null,
      pos_machine: r.posMachine
        ? {
            id: r.posMachine.id,
            mid_number: r.posMachine.mid_number,
            tid_number: r.posMachine.tid_number,
            device_serial_number: r.posMachine.device_serial_number,
          }
        : null,
    };
  });

  res.status(200).json({
    success: true,
    message: "Super Admin transaction report fetched successfully",
    summary: {
      total_volume: parseFloat(totalVolume.toFixed(2)),
      total_count: count,
      success_count: successCount,
      failed_count: failedCount,
      success_rate: count > 0 ? parseFloat(((successCount / count) * 100).toFixed(2)) : 0,
    },
    pagination: {
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum) || 1,
    },
    data: formattedRows,
  });
});

/**
 * GET /api/super-admin/reports/commissions
 * Super Admin Commission & Merchant Charges Report
 */
const getSuperAdminCommissionReport = asyncHandler(async (req, res) => {
  checkSuperAdminAccess(req, res);

  const {
    page = 1,
    limit = 10,
    domain,
    company_id,
    from_date,
    to_date,
    payment_method,
    search,
    q,
  } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;
  const searchTerm = (search || q || "").trim();

  const where = {};

  // Company / Domain filter
  let resolvedCompanyId = company_id;
  if (!resolvedCompanyId && domain) {
    const comp = await Company.findOne({
      where: {
        [Op.or]: [
          { domain_name: domain },
          { domain_name: { [Op.iLike]: `%${domain}%` } },
        ],
      },
    });
    if (comp) {
      resolvedCompanyId = comp.company_id;
    }
  }

  // Filter merchants belonging to this company if specified
  if (resolvedCompanyId) {
    const companyMerchants = await User.findAll({
      where: { company_id: resolvedCompanyId },
      attributes: ["id"],
    });
    const merchantIds = companyMerchants.map((u) => u.id);
    where.merchant_id = { [Op.in]: merchantIds.length ? merchantIds : [-1] };
  }

  // Date range filter
  if (from_date || to_date) {
    const range = parseIstBusinessDateRange(from_date, to_date, { defaultToToday: false });
    if (range.error) {
      return res.status(400).json({ success: false, message: range.error });
    }
    if (range.fromDate && range.toDate) {
      where.createdAt = { [Op.between]: [range.fromDate, range.toDate] };
    } else if (range.fromDate) {
      where.createdAt = { [Op.gte]: range.fromDate };
    } else if (range.toDate) {
      where.createdAt = { [Op.lte]: range.toDate };
    }
  }

  // Payment method filter
  if (payment_method) {
    where.payment_method = payment_method;
  }

  // Keyword search
  if (searchTerm) {
    const matchingUsers = await User.findAll({
      where: {
        [Op.or]: [
          { name: { [Op.iLike]: `%${searchTerm}%` } },
          { email: { [Op.iLike]: `%${searchTerm}%` } },
          { mobile_number: { [Op.iLike]: `%${searchTerm}%` } },
          { abheepay_id: { [Op.iLike]: `%${searchTerm}%` } },
        ],
      },
      attributes: ["id"],
      limit: 50,
    });
    const userIds = matchingUsers.map((u) => u.id);

    where[Op.or] = [
      { razorpay_transaction_id: { [Op.iLike]: `%${searchTerm}%` } },
      ...(userIds.length > 0 ? [{ merchant_id: { [Op.in]: userIds } }] : []),
    ];
  }

  const { count, rows } = await MerchantTransactionCharge.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: limitNum,
    offset,
  });

  // Fetch unique merchants, POS machines, and companies
  const merchantIds = [...new Set(rows.map((r) => r.merchant_id).filter(Boolean))];
  const merchants = merchantIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: merchantIds } },
        attributes: ["id", "name", "email", "mobile_number", "abheepay_id", "company_id"],
      })
    : [];
  const merchantMap = new Map(merchants.map((m) => [m.id, m]));

  const posIds = [...new Set(rows.map((r) => r.pos_machine_id).filter(Boolean))];
  const posMachines = posIds.length
    ? await PosMachine.findAll({
        where: { id: { [Op.in]: posIds } },
        attributes: ["id", "mid_number", "tid_number", "device_serial_number"],
      })
    : [];
  const posMap = new Map(posMachines.map((p) => [p.id, p]));

  const companyIds = [...new Set(merchants.map((m) => m.company_id).filter(Boolean))];
  const companies = companyIds.length
    ? await Company.findAll({
        where: { company_id: { [Op.in]: companyIds } },
        attributes: ["company_id", "company_name", "domain_name"],
      })
    : [];
  const companyMap = new Map(companies.map((c) => [c.company_id, c]));

  // Calculate summaries across all matching records
  const allMatching = await MerchantTransactionCharge.findAll({
    where,
    attributes: ["transaction_amount", "charge_amount", "gst_amount", "net_amount"],
  });

  let totalTxnVolume = 0;
  let totalCommissionRevenue = 0;
  let totalGst = 0;
  let totalNet = 0;

  for (const item of allMatching) {
    totalTxnVolume += parseFloat(item.transaction_amount) || 0;
    totalCommissionRevenue += parseFloat(item.charge_amount) || 0;
    totalGst += parseFloat(item.gst_amount) || 0;
    totalNet += parseFloat(item.net_amount) || 0;
  }

  const formattedRows = rows.map((r) => {
    const merchant = merchantMap.get(r.merchant_id) || null;
    const pos = r.pos_machine_id ? posMap.get(r.pos_machine_id) || null : null;
    const comp = merchant?.company_id ? companyMap.get(merchant.company_id) || null : null;

    return {
      id: r.id,
      razorpay_transaction_id: r.razorpay_transaction_id,
      rr_number: r.rr_number || null,
      transaction_amount: parseFloat(r.transaction_amount) || 0,
      charge_amount: parseFloat(r.charge_amount) || 0,
      charge_rate: parseFloat(r.charge_rate) || 0,
      gst_percent: parseFloat(r.gst_percent) || 0,
      gst_amount: parseFloat(r.gst_amount) || 0,
      net_amount: parseFloat(r.net_amount) || 0,
      payment_method: r.payment_method,
      payment_card_type: r.payment_card_type,
      payment_card_brand: r.payment_card_brand,
      createdAt: r.createdAt,
      company: comp
        ? {
            company_id: comp.company_id,
            company_name: comp.company_name,
            domain_name: comp.domain_name,
          }
        : merchant?.company_id
        ? { company_id: merchant.company_id, company_name: merchant.company_id, domain_name: "-" }
        : null,
      merchant: merchant
        ? {
            id: merchant.id,
            name: merchant.name,
            email: merchant.email,
            mobile_number: merchant.mobile_number,
            abheepay_id: merchant.abheepay_id,
          }
        : null,
      pos_machine: pos
        ? {
            id: pos.id,
            mid_number: pos.mid_number,
            tid_number: pos.tid_number,
            device_serial_number: pos.device_serial_number,
          }
        : null,
    };
  });

  res.status(200).json({
    success: true,
    message: "Super Admin commission report fetched successfully",
    summary: {
      total_transaction_volume: parseFloat(totalTxnVolume.toFixed(2)),
      total_commission_revenue: parseFloat(totalCommissionRevenue.toFixed(2)),
      total_gst_collected: parseFloat(totalGst.toFixed(2)),
      total_net_payout: parseFloat(totalNet.toFixed(2)),
      total_records: count,
    },
    pagination: {
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum) || 1,
    },
    data: formattedRows,
  });
});

/**
 * GET /api/super-admin/reports/service-wise
 * Super Admin Service-Wise Report aggregating real transaction and fee metrics
 */
const getSuperAdminServiceWiseReport = asyncHandler(async (req, res) => {
  checkSuperAdminAccess(req, res);

  const { search, q, category } = req.query;
  const searchTerm = (search || q || "").trim().toLowerCase();

  // 1. Fetch all registered service settings from DB
  const dbServices = await ServiceSetting.findAll();
  const dbMap = new Map();
  dbServices.forEach((s) => {
    dbMap.set(s.service_key, s.toJSON ? s.toJSON() : s);
  });

  const DEFAULT_SERVICES = [
    { key: "vimo_payout", label: "Vimo Payout", category: "Payout & Banking", description: "Vimo Native Payout Gateway Integration" },
    { key: "branchx_payout", label: "BranchX Payout", category: "Payout & Banking", description: "BranchX Direct Payout Service" },
    { key: "sevenpay_payout", label: "SevenPay Payout", category: "Payout & Banking", description: "SevenPay Payout Gateway Integration" },
    { key: "ndia5_payout", label: "Ndia5 Payout", category: "Payout & Banking", description: "NDIA5 Direct Bank Settlement Gateway" },
    { key: "mx_payout", label: "Payout MX", category: "Payout & Banking", description: "MeroRecharge Payout Gateway" },
    { key: "cc_bill_pay", label: "Credit Card Bill Pay", category: "Credit Card & Utility", description: "Direct Credit Card Bill Payment Engine" },
    { key: "ba_cc_bill_pay", label: "BillAvenue CC Bill Pay", category: "Credit Card & Utility", description: "BillAvenue BBPS Credit Card Bill Payment" },
    { key: "cc_bill_3", label: "CC Bill 3", category: "Credit Card & Utility", description: "CC Bill 3 Payment Route" },
    { key: "pos_inventory", label: "POS Machine Hardware", category: "POS & Hardware", description: "POS Terminal Transaction Processing" },
    { key: "pos_t0_settlement", label: "POS Instant T0 Settlement", category: "Settlement & Limits", description: "Same-Day POS Settlement Engine" },
    { key: "qr_payments", label: "Digital QR Collections", category: "Digital QR", description: "Dynamic Soundbox & Standee QR" },
  ];

  // Merge default metadata with DB services
  const allServices = [...DEFAULT_SERVICES];
  dbServices.forEach((s) => {
    if (!allServices.some((m) => m.key === s.service_key)) {
      allServices.push({
        key: s.service_key,
        label: s.label || s.service_key,
        category: s.category || "General",
        description: s.description || "",
      });
    }
  });

  // 2. Fetch real aggregates from POS transactions
  let posVolume = 0;
  let posTxnCount = 0;
  let posSuccessCount = 0;
  try {
    const posTxns = await RazorpayNotification.findAll({
      attributes: ["amount", "status"],
    });
    posTxnCount = posTxns.length;
    for (const txn of posTxns) {
      posVolume += parseFloat(txn.amount) || 0;
      if (txn.status === "captured") {
        posSuccessCount++;
      }
    }
  } catch (_) {}

  // 3. Fetch real charges & commissions from MerchantTransactionCharge
  let posCharges = 0;
  let posCommission = 0;
  try {
    const charges = await MerchantTransactionCharge.findAll({
      attributes: ["charge_amount", "net_amount", "transaction_amount"],
    });
    for (const c of charges) {
      posCharges += parseFloat(c.charge_amount) || 0;
    }
  } catch (_) {}

  // 4. Map each service to real database totals (NO mock dummy data)
  const rows = allServices.map((service) => {
    const dbRecord = dbMap.get(service.key);
    const isEnabled = dbRecord ? dbRecord.is_enabled !== false : true;

    // Attribute real volume based on service type
    let volume = 0;
    let txns = 0;
    let charges = 0;
    let commission = 0;
    let successRate = 100;

    if (service.key === "pos_inventory" || service.key === "pos_t0_settlement") {
      volume = posVolume;
      txns = posTxnCount;
      charges = posCharges;
      commission = posCommission;
      successRate = posTxnCount > 0 ? parseFloat(((posSuccessCount / posTxnCount) * 100).toFixed(1)) : 100;
    }

    const netProfit = charges - commission;
    const avgTicket = txns > 0 ? Math.round(volume / txns) : 0;

    return {
      key: service.key,
      label: dbRecord?.label || service.label,
      category: dbRecord?.category || service.category,
      description: dbRecord?.description || service.description,
      isEnabled,
      volume: parseFloat(volume.toFixed(2)),
      txns,
      successRate,
      avgTicket,
      charges: parseFloat(charges.toFixed(2)),
      commission: parseFloat(commission.toFixed(2)),
      netProfit: parseFloat(netProfit.toFixed(2)),
    };
  });

  // Apply search and category filtering
  const filteredRows = rows.filter((r) => {
    const matchesSearch =
      !searchTerm ||
      r.label.toLowerCase().includes(searchTerm) ||
      r.key.toLowerCase().includes(searchTerm) ||
      r.category.toLowerCase().includes(searchTerm);

    const matchesCategory =
      !category || category === "All" || r.category.toLowerCase() === category.toLowerCase();

    return matchesSearch && matchesCategory;
  });

  // Total summary calculations
  const totalVolume = filteredRows.reduce((acc, r) => acc + r.volume, 0);
  const totalTxns = filteredRows.reduce((acc, r) => acc + r.txns, 0);
  const totalCharges = filteredRows.reduce((acc, r) => acc + r.charges, 0);
  const totalCommission = filteredRows.reduce((acc, r) => acc + r.commission, 0);
  const totalNetProfit = totalCharges - totalCommission;

  res.status(200).json({
    success: true,
    message: "Service wise report fetched successfully",
    summary: {
      total_volume: parseFloat(totalVolume.toFixed(2)),
      total_txns: totalTxns,
      total_charges: parseFloat(totalCharges.toFixed(2)),
      total_commission: parseFloat(totalCommission.toFixed(2)),
      total_net_profit: parseFloat(totalNetProfit.toFixed(2)),
    },
    data: filteredRows,
  });
});

module.exports = {
  getSuperAdminData,
  getAdminDetails,
  createSuperAdmin,
  updateAdmin,
  updateAdminStatus,
  getSuperAdminPosInventory,
  getSuperAdminTransactionReport,
  getSuperAdminCommissionReport,
  getSuperAdminServiceWiseReport,
};
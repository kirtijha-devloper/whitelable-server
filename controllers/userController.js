const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const  User = require('../models/User');
const db = require('../config/database');
const UsernameSequence = require('../models/UsernameSequence');

const fs = require("fs");
const path = require("path");

// file-based logger for authentication diagnosis
const AUTH_LOG_DIR = path.join(__dirname, "../logs");
const AUTH_LOG_FILE = path.join(AUTH_LOG_DIR, "auth.log");
if (!fs.existsSync(AUTH_LOG_DIR)) {
  fs.mkdirSync(AUTH_LOG_DIR, { recursive: true });
}
function _authTs() {
  return new Date().toISOString();
}
function _authFileLog(level, args) {
  const parts = args.map((a) =>
    a instanceof Error
      ? `${a.message}\n${a.stack}`
      : typeof a === "object" && a !== null
      ? JSON.stringify(a, null, 2)
      : String(a)
  );
  const line = `[${_authTs()}] [${level}] ${parts.join(" ")}\n`;
  try {
    fs.appendFileSync(AUTH_LOG_FILE, line);
  } catch (_) { /* ignore */ }
}
const authLogger = {
  log:   (...args) => { console.log(...args);   _authFileLog("INFO",  args); },
  warn:  (...args) => { console.warn(...args);  _authFileLog("WARN",  args); },
  error: (...args) => { console.error(...args); _authFileLog("ERROR", args); },
};
const Tpin = require('../models/Tpin');
const { Op, fn, col } = require('sequelize');
const PosMachine = require("../models/posMachine");
const OTP = require("../models/Otp");
const sendOtpHelper = require("../utils/sendOtp");
const { sendRegistrationSms } = require("../utils/sendOtp");
const sendEmailOtp = require("../utils/emailOtp");
const { sendMail } = require("../utils/mail");

const PosTransactionCharge = require('../models/PosTransactionCharge');
const PayoutCharge = require('../models/PayoutCharge');
const Rental = require('../models/Rental');

// helper used during registration to allocate a unique username
function prefixForRole(role) {
  switch (role) {
    case 'merchant': return 'APM';
    case 'franchaise': return 'APF';
    case 'admin': return 'APA';
    default: return 'APX';
  }
}

async function allocateUsernameForRole(role, transaction) {
  const prefix = prefixForRole(role);

  // try to fetch the sequence row with an update lock. if it doesn't exist, create it.
  let seq = await UsernameSequence.findOne({
    where: { prefix },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (!seq) {
    seq = await UsernameSequence.create({ prefix, current_value: 1 }, { transaction });
    return `${prefix}${String(1).padStart(5, '0')}`;
  }

  seq.current_value += 1;
  await seq.save({ transaction });
  return `${prefix}${String(seq.current_value).padStart(5, '0')}`;
}

const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
// if Cloudinary isn't configured (or we're testing) stub the uploader
if (!process.env.CLOUDINARY_API_KEY || process.env.NODE_ENV === 'test') {
  cloudinary.uploader.upload = async (filePath, opts) => {
    return { secure_url: `https://dummy.cloudinary.test/${filePath.split(/[\\\/]/).pop()}` };
  };
}

const getUsers = asyncHandler(async (req, res) => {
    try {
        const { 
            status, 
            role,
            page = 1, 
            limit = 10 
        } = req.query;

        const userRole = req.user?.role;
        const userId = req.user?.id;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const where = {};

        // Role-based access control
        if (userRole === 'franchaise') {
            // Franchise can only see their own merchants
            where.franchaise_id = userId;
        }

        // Apply filters
        if (status) {
            where.status = status;
        }

        if (role) {
            where.role = role;
        }

        // Get total count and paginated results
        const { count, rows: users } = await User.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['createdAt', 'DESC']]
        });

        // Add POS machine assignment count per user (if any in this page)
        const userIds = users.map((u) => u.id);
        const posCounts = userIds.length
          ? await PosMachine.findAll({
              where: { assigned_user_id: userIds },
              attributes: [
                'assigned_user_id',
                [fn('COUNT', col('id')), 'count'],
              ],
              group: ['assigned_user_id'],
            })
          : [];

        const posCountMap = posCounts.reduce((acc, row) => {
          acc[row.assigned_user_id] = parseInt(row.get('count'), 10);
          return acc;
        }, {});

        const usersWithPosCount = users.map((u) => {
          const plain = u.toJSON ? u.toJSON() : u;
          plain.pos_machine_count = posCountMap[u.id] || 0;
          return plain;
        });

        res.status(200).json({
            success: true,
            message: 'Users retrieved successfully',
            data: usersWithPosCount,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Something went wrong'
        });
    }
});

// simple public endpoint used for testing authentication issues in prod
// returns total number of users in the database
const userCount = asyncHandler(async (req, res) => {
    try {
        const count = await User.count();
        res.status(200).json({ success: true, count });
    } catch (err) {
        console.error('Count users error:', err);
        res.status(500).json({ success: false, message: err.message || 'Something went wrong' });
    }
});

const getUserByID = asyncHandler(async (req, res) => {
  try {
    const role = req.user.role;
    const searchedId = req.params.id;
    const isPosDetailRequired = req.query.is_pos_detail_required === 'true';

    const searchedUser = await User.findByPk(searchedId);

    if (!searchedUser) {
      res.status(404);
      throw new Error("User Not Found.");
    }

    if (role === "franchaise") {
      if (searchedUser.role === "franchaise" && searchedUser.id !== req.user.id) {
        res.status(403);
        throw new Error("You are not allowed to view this user.");
      }
      // Additional check: franchise can only see their merchants
      // if (searchedUser.role === "merchant" && searchedUser.franchaise_id !== req.user.id) {
      //   res.status(403);
      //   throw new Error("You are not allowed to view this user.");
      // }
    }

    if (role === "merchant") {
      if (req.user.id !== Number(searchedId)) {
        res.status(403);
        throw new Error("You are not allowed to view this user.");
      }
    }

    const response = {};
    response.user = searchedUser;

    // Fetch charges associated with merchant (if merchant role)
    if (searchedUser.role === "merchant" || role === "admin") {
      const charges = {};

      // 1. POS Transaction Charges
      const posTransactionCharges = await PosTransactionCharge.findAll({
        where: { merchant_id: searchedId },
        order: [['is_default', 'DESC'], ['createdAt', 'DESC']]
      });
      charges.pos_transaction_charges = posTransactionCharges.map(charge => ({
        id: charge.id,
        merchant_id: charge.merchant_id,
        method: charge.method,
        network: charge.network,
        card_type: charge.card_type,
        subtype: charge.subtype,
        rate_percentage: parseFloat(charge.rate_percentage) || 0,
        is_default: charge.is_default,
        createdAt: charge.createdAt,
        updatedAt: charge.updatedAt
      }));

      // 2. Payout Charges
      const payoutCharges = await PayoutCharge.findAll({
        where: { merchant_id: searchedId },
        order: [['is_default', 'DESC'], ['createdAt', 'DESC']]
      });
      charges.payoutCharges = payoutCharges.map(charge => ({
        id: charge.id,
        merchant_id: charge.merchant_id,
        min: charge.min ? parseFloat(charge.min) : null,
        max: charge.max ? parseFloat(charge.max) : null,
        amount: charge.amount ? parseFloat(charge.amount) : null,
        percentage: charge.percentage ? parseFloat(charge.percentage) : null,
        status: charge.status,
        is_default: charge.is_default,
        createdAt: charge.createdAt,
        updatedAt: charge.updatedAt
      }));

      // 3. Rentals
      const rentals = await Rental.findAll({
        where: { merchant_id: searchedId },
        order: [['is_default', 'DESC'], ['createdAt', 'DESC']]
      });
      charges.rentals = rentals.map(rental => ({
        id: rental.id,
        merchant_id: rental.merchant_id,
        franchaise_id: rental.franchaise_id,
        amount: parseFloat(rental.amount) || 0,
        status: rental.status,
        type: rental.type,
        is_default: rental.is_default,
        createdAt: rental.createdAt,
        updatedAt: rental.updatedAt
      }));

      response.charges = charges;
    }

    // POS Details (if requested)
    if (isPosDetailRequired) {
      let posDetails = [];
      if (searchedUser.role === "merchant") {
        posDetails = await PosMachine.findAll({
          where: {
            assigned_user_id: searchedId,
            status: "active"
          }
        });
      } else if (searchedUser.role === "franchaise") {
        posDetails = await PosMachine.findAll({
          where: {
            franchaise_id: searchedId,
            status: "active"
          }
        });
      }
      response.pos_details = posDetails;
    }

    res.status(200).json(response);
    
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message || "Something went wrong",
    });
  }
});




const registerUser = asyncHandler(async (req, res) => {
    try {
        // pull off company/shop name as well (optional)
        const { email, password, role, company_or_shop_name } = req.body;
        const mobileNumber = req.body.mobile_number;

        // validate required fields with explicit error messages
        const missingFields = [];
        if (!mobileNumber) missingFields.push('mobile_number');
        if (!password) missingFields.push('password');
        if (!role) missingFields.push('role');
        if (!email) missingFields.push('email');

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required field${missingFields.length > 1 ? 's' : ''}: ${missingFields.join(', ')}`,
            });
        }

        const allowedRoles = ['merchant', 'franchise', 'admin'];
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                message: `Invalid role: '${role}'. Allowed values are: ${allowedRoles.join(', ')}`,
            });
        }

        // bank passbook must be uploaded by requirement
        const bankPassbookFile = req.files?.bank_passbook;
        if (!bankPassbookFile) {
            return res.status(400).json({
                success: false,
                message: "Bank passbook file is required for registration",
            });
        }

        // Avoid registering the same mobile/email again (active users only)
        const existingMobile = await User.findOne({
            where: { mobile_number: mobileNumber, status: "active" }
        });
        if (existingMobile) {
            return res.status(409).json({
                success: false,
                message: "Mobile number is already registered",
            });
        }

        const existingEmail = await User.findOne({
            where: { email, status: "active" }
        });
        if (existingEmail) {
            return res.status(409).json({
                success: false,
                message: "Email is already registered",
            });
        }

        const hashPassword = await bcrypt.hash(password, 10);

        // Normalise role: frontend sends "franchise", DB stores "franchaise"
        const normalizedRole = role === 'franchise' ? 'franchaise' : role;

        // abheepay_id is the same as the generated username (token) for this user.
        // This makes the identifier consistent between the user record and login username.
        let abheepay_id = null;

        // Handle file uploads to Cloudinary
        const panFile          = req.files?.pan_photo;
        const aadharFile       = req.files?.aadhar_photo;
        const aadharBkFile     = req.files?.aadhar_back_photo;
        const shopFile         = req.files?.shop_photo;
        // bankPassbookFile already validated above

        const [panUrl, aadharUrl, aadharBkUrl, shopUrl, bankPassbookUrl] = await Promise.all([
            panFile          ? cloudinary.uploader.upload(panFile.tempFilePath,          { folder: 'users' }) : null,
            aadharFile       ? cloudinary.uploader.upload(aadharFile.tempFilePath,       { folder: 'users' }) : null,
            aadharBkFile     ? cloudinary.uploader.upload(aadharBkFile.tempFilePath,     { folder: 'users' }) : null,
            shopFile         ? cloudinary.uploader.upload(shopFile.tempFilePath,         { folder: 'users' }) : null,
            bankPassbookFile ? cloudinary.uploader.upload(bankPassbookFile.tempFilePath, { folder: 'users' }) : null,
        ]);

        // allocate username (and use it as abheepay_id) inside the same transaction so rollback works
        let user;
        await db.transaction(async (t) => {
            const username = await allocateUsernameForRole(normalizedRole, t);
            abheepay_id = username;

            user = await User.create({
                email,
                password: hashPassword,
                role: normalizedRole,
                mobile_number: mobileNumber,
                mobile_number_country_code: req.body.mobile_number_country_code || '+91',
                abheepay_id,
                name: req.body.name,
                gender: req.body.gender,
                dob: req.body.dob || null,
                address1: req.body.address1,
                address2: req.body.address2,
                city: req.body.city,
                district: req.body.district,
                pincode: req.body.pincode,
                state: req.body.state,
                aadhar_number: req.body.aadhar_number,
                pan_number: req.body.pan_number,
                pan_number_url:        panUrl?.secure_url    || null,
                aadhar_number_url:     aadharUrl?.secure_url || null,
                aadhar_back_number_url: aadharBkUrl?.secure_url || null,
                shop_with_photo_url:   shopUrl?.secure_url   || null,
                bank_passbook_url:      bankPassbookUrl?.secure_url || null,
                settlement_type: req.body.settlement_type || 'today_settlement',
                is_approved: false,
                status: 'active',
                company_or_shop_name: company_or_shop_name || null,
                username,
                ...(req.user && req.user.role === 'franchaise' && normalizedRole === 'merchant' && { franchaise_id: req.user.id }),
            }, { transaction: t });
        });

        console.log('User created', user);

        if (!user) {
            res.status(400);
            throw new Error('User is not valid!');
        }

        // Assign POS machines if provided
        let posAssigned = false;
        let posAssignError = null;
        if (req.body.pos_machine_ids) {
            try {
                const posMachineIds = JSON.parse(req.body.pos_machine_ids);
                if (Array.isArray(posMachineIds) && posMachineIds.length > 0) {
                    await PosMachine.update(
                        {
                            status: 'active',
                            ...(normalizedRole === 'franchaise' && { franchaise_id: user.id }),
                            ...(normalizedRole === 'merchant'   && { assigned_user_id: user.id }),
                        },
                        { where: { id: posMachineIds } }
                    );
                    if (normalizedRole === 'merchant') {
                        user.is_pos_asigned = true;
                        await user.save();
                    }
                    posAssigned = true;
                }
            } catch (posErr) {
                posAssignError = posErr.message;
                console.error('Failed to assign POS machines:', posErr);
            }
        }

        // Send SMS with user ID and password after successful registration
        let smsSent = false;
        let smsError = null;
        try {
            await sendRegistrationSms(
                user.mobile_number,
                user.abheepay_id || user.id,
                password,
                user.name || (user.abheepay_id || user.id)
            );
            smsSent = true;
            console.log(`Registration SMS sent successfully to ${user.mobile_number}`);
        } catch (smsErr) {
            smsError = smsErr.message || 'Failed to send SMS';
            console.error('Failed to send registration SMS:', smsErr);
        }

        // send welcome email with credentials if we have an email address
        let emailSent = false;
        let emailError = null;

        if (user.email) {
            try {
                const loginUrl = process.env.FRONTEND_URL || 'https://pos.abheepay.com/';
                await sendMail({
                    to: user.email,
                    subject: 'Abheepay POS Account Created',
                    html: `
                        <p>Dear User,</p>
                        <p>Your Franchise / User Account has been successfully created. 🎉</p>
                        <p>🔹 <strong>User ID</strong>: ${user.abheepay_id || user.id}</p>
                        <p>🔹 <strong>Mobile Number for Login</strong>: ${user.mobile_number}</p>
                        <p>🔹 <strong>Password</strong>: ${password}</p>
                        <p>⚠️ For security reasons, please change your password after your first login.</p>
                        <p>🔗 <a href="${loginUrl}">Login Here</a></p>
                        <p>We wish you a successful business and a great day ahead.</p>
                        <p>Team – ABHEEPAY</p>
                    `,
                });
                emailSent = true;
            } catch (emailErr) {
                emailError = emailErr.message || 'Failed to send email';
                console.error('Failed to send registration email:', emailErr);
            }
        }

        const userPayload = {
            id: user.id,
            email: user.email,
            mobile_number: user.mobile_number,
            abheepay_id: user.abheepay_id,
            role: user.role,
        };

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            // "user" key: matches frontend usage of resp.user.id
            user: userPayload,
            // "data" key: kept for backwards compatibility
            data: userPayload,
            pos: {
                assigned: posAssigned,
                message: posAssigned
                    ? 'POS machines assigned successfully'
                    : posAssignError || 'No POS machines assigned',
            },
            sms: {
                sent: smsSent,
                message: smsSent
                    ? 'Registration details sent via SMS'
                    : `Registration successful, but SMS could not be sent: ${smsError || 'Unknown error'}`,
            },
            email: {
                sent: emailSent,
                message: emailSent
                    ? 'Registration details sent via Email'
                    : `Registration successful, but email could not be sent: ${emailError || 'Unknown error'}`,
            },
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Something went wrong',
        });
    }
});

const loginUser = asyncHandler(async (req, res) => {

    authLogger.log('STEP 1: loginUser invoked', { body: req.body });

    const { password } = req.body;
    const mobileNumber = req.body.mobile_number;

    if (!mobileNumber || !password) {
        authLogger.warn('STEP 2: Missing fields');
        res.status(400);
        throw new Error("All fields are mandatory!");
    }

authLogger.log('STEP 3: Before DB query');

    // measure query time and catch DB errors
    let user;
    const queryStart = Date.now();
    try {
        user = await User.findOne({
            where: { mobile_number: mobileNumber }
        });
    } catch (dbErr) {
        authLogger.error('STEP 3a: DB query error', dbErr);
        // return 500 to caller, bail out
        res.status(500).json({ success: false, message: 'Database error' });
        return;
    }
    const queryDuration = Date.now() - queryStart;
    authLogger.log('STEP 4: After DB query', {
        userFound: !!user,
        durationMs: queryDuration
    });
    if (queryDuration > 1000) {
        authLogger.warn('STEP 4a: DB query unusually slow', { durationMs: queryDuration });
    }

    if (!user) {
        authLogger.warn('STEP 5: User not found', { mobileNumber });
        return res.status(401).json({
            message: "Mobile Number or Password are not valid!"
        });
    }

    authLogger.log('STEP 6: Before bcrypt compare');

    const passwordMatch = await bcrypt.compare(password, user.password);

    authLogger.log('STEP 7: After bcrypt compare', {
        passwordMatch
    });

    if (!passwordMatch) {
        authLogger.warn('STEP 8: Password mismatch');
        return res.status(401).json({
            message: "Mobile Number or Password are not valid!"
        });
    }

    authLogger.log('STEP 9: Login successful - sending OTP response');

    // generate and dispatch OTP via SMS using Bulk9
    let otp;
    try {
        otp = await sendOtpHelper(mobileNumber, 'login', { name: user.name || 'Customer' });
        authLogger.log('STEP 9a: SMS OTP sent');
    } catch (smsErr) {
        authLogger.error('STEP 9a: SMS send failed', smsErr);
    }

    // if we still have an email address, also send email copy
    if (user.email) {
        try {
            if (otp !== undefined) {
                // SMS generation succeeded, reuse same code
                await sendEmailOtp(mobileNumber, user.email, "login", otp);
            } else {
                // SMS failed, let email helper generate its own OTP
                await sendEmailOtp(mobileNumber, user.email, "login");
            }
            authLogger.log('STEP 9b: Email OTP sent');
        } catch (emailErr) {
            authLogger.error('STEP 9b: Email send failed', emailErr);
        }
    }

    return res.json({
        success: true,
        message: "OTP sent successfully to your mobile number" + (user.email ? " and email address" : ""),
    });

});


const approveUser = asyncHandler( async (req, res) => {
    const role = req.user.role
    if (role !== "admin")
        throw new Error ("You are not allowed!")

    const id = req.params.id
    const user = await User.findOne({ where: { id } });

    user.is_approved = true;

    await user.save();
    if (user) {
        res.status(200).json(user)
    } else {
        res.status(404);
            throw new Error ("NoT Found !")
    };

});

    const currentUser = asyncHandler( async (req, res) => {
        try {
                const user = await User.findOne({ where: { mobile_number: req.user.mobile_number } })

                const tpinRecord = await Tpin.findOne({
                  where: { user_id: user.id }
                });

                res.json({
                    email: user.email,
                    mobile_number: user.mobile_number, 
                    name: (user.name || "NA"), 
                    mobile_number_country_code: (user.mobile_number_country_code || "+91"),
                    role: user.role || "merchant",
                    abheepay_id: user.abheepay_id,
                    is_approved: user.is_approved,
                    organization_name: user.organization_name || "NA",
                    status: user.status,
                    is_pos_asigned: ( user.is_pos_asigned || false),
                    wallet: user.wallet,
                    wallet_hold: user.wallet_hold,
                    tpin_set: !!tpinRecord,
                    ipay_outlet_id: user.ipay_outlet_id || null,

                    id: user.id
            });
        } catch(err) {
        res.status(404);
            throw new Error("token is expired!")
        }
        });

    const updatePassword = asyncHandler(async (req, res) => {
        // Support two modes:
        // 1. Admin may reset any user's password by supplying { id, newPassword }.
        // 2. Non-admin users may change their own password by supplying
        //    { id, currentPassword, newPassword }.
        const { id, currentPassword, newPassword } = req.body;

        if (!id || !newPassword) {
            res.status(400);
            throw new Error("User ID and newPassword are required");
        }

        const targetId = Number(id);
        const requester = req.user;

        // load target user record
        const user = await User.findByPk(targetId);
        if (!user) {
            res.status(404);
            throw new Error("User not found.");
        }

        if (requester.role === 'admin') {
            // Admin may change anyone's password without further checks
        } else {
            // Non-admins can only change their own password
            if (requester.id !== targetId) {
                res.status(401);
                throw new Error("You are not authorized to change this password.");
            }
            if (!currentPassword) {
                res.status(400);
                throw new Error("currentPassword is required to change your password");
            }
            const match = await bcrypt.compare(currentPassword, user.password);
            if (!match) {
                res.status(401);
                throw new Error("Current password is incorrect.");
            }
        }

        const hashPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashPassword;
        await user.save();

        res.status(200).json({ message: "Password updated successfully." });
    });


    const updateFranchaiseID = asyncHandler(async (req, res) => {});



// --- backup: original sendOtp preserved as sendOtp_bck ---
const sendOtp_bck = asyncHandler(async (req, res) => {
    try {
        const { mobile_number, purpose } = req.body;

        if (!mobile_number || !purpose) {
            res.status(400);
            throw new Error("Mobile number and purpose are required");
        }

        if (!["login", "forgot_password", "tpin", "registration"].includes(purpose)) {
            res.status(400);
            throw new Error("Invalid purpose. Must be 'login', 'forgot_password', or 'tpin'");
        }

        // For forgot_password, check if user exists
        if (purpose === "forgot_password" || purpose === "tpin") {
            const user = await User.findOne({ 
                where: { 
                    mobile_number: mobile_number,
                    status: 'active' 
                } 
            });

            if (!user) {
                // Don't reveal if user exists
                res.status(200).json({ 
                    success: true, 
                    message: "If the mobile number exists, an OTP has been sent" 
                });
                return;
            }
        }

        // if we have an email for this number, dispatch email OTP
        let emailAddr;
        const user = await User.findOne({ where: { mobile_number, status: 'active' } });
        if (user && user.email) {
            emailAddr = user.email;
            await sendEmailOtp(mobile_number, emailAddr, purpose);
        }
        res.status(200).json({ 
            success: true, 
            message: "OTP sent successfully" 
        });
    } catch (err) {
        console.error("Failed to send OTP:", err);
        res.status(500).json({ 
            success: false,
            message: err.message || "Failed to send OTP" 
        });
    }
});


// --- sendOtp endpoint – currently email-only, SMS disabled ---
const sendOtp = asyncHandler(async (req, res) => {
  try {
    const { mobile_number, purpose } = req.body;

    if (!mobile_number || !purpose) {
      res.status(400);
      throw new Error("Mobile number and purpose are required");
    }

    if (!["login", "forgot_password", "tpin", "registration"].includes(purpose)) {
      res.status(400);
      throw new Error("Invalid purpose. Must be 'login', 'forgot_password', 'tpin' or 'registration'");
    }

    // for sensitive purposes, do not reveal existence of user
    let emailAddr;
    if (purpose === "forgot_password" || purpose === "tpin") {
      const user = await User.findOne({ where: { mobile_number: mobile_number, status: 'active' } });
      if (!user) {
        res.status(200).json({ success: true, message: "If the mobile number exists, an OTP has been sent" });
        return;
      }
      emailAddr = user.email;
    }

    // always send SMS via Bulk9 helper (which also persists the OTP)
    let otp;
    try {
      // try to supply name when we have a resolved user record
      let nameOpt = undefined;
      if (emailAddr) {
        const u = await User.findOne({ where: { mobile_number } });
        if (u && u.name) nameOpt = { name: u.name };
      }
      otp = await sendOtpHelper(mobile_number, purpose, nameOpt);
      console.log(`SMS OTP generated and sent for ${mobile_number}`);
    } catch (smsErr) {
      console.error("SMS dispatch failed", smsErr);
    }

    // additionally send an email copy if we have an address
    if (emailAddr) {
      try {
        if (otp !== undefined) {
          await sendEmailOtp(mobile_number, emailAddr, purpose, otp);
        } else {
          await sendEmailOtp(mobile_number, emailAddr, purpose);
        }
      } catch (emailErr) {
        console.error("Email OTP failed", emailErr);
      }
    }

    res.status(200).json({ success: true, message: "OTP sent successfully" });
  } catch (err) {
    console.error("Failed to send OTP:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to send OTP" });
  }
});

  // --- backup: original verifyOtp preserved as verifyOtp_bck ---
  const verifyOtp_bck = asyncHandler(async (req, res) => {
    const { mobile_number, otp, purpose } = req.body;

    if (!mobile_number || !otp || !purpose) {
        res.status(400);
        throw new Error("Mobile number, OTP, and purpose are required");
    }

    if (!["login", "forgot_password", "registration", "tpin"].includes(purpose)) {
        res.status(400);
        throw new Error("Invalid purpose");
    }

    // Bypass OTP verification for specific mobile number
    const BYPASS_MOBILE_NUMBER = "8873962933";
    const shouldBypassOtp = mobile_number === BYPASS_MOBILE_NUMBER;

    if (!shouldBypassOtp) {
        const record = await OTP.findOne({
            where: {
                mobile: mobile_number,
                otp,
                purpose,
                expires_at: { [Op.gt]: new Date() }
            }
        });

        if (!record) {
            res.status(400);
            throw new Error("Invalid or expired OTP");
        }

        // Delete OTP after use (one-time use)
        await record.destroy();
    }

    if (purpose === "login") {
        // Issue login token
        const user = await User.findOne({ 
            where: { 
                mobile_number: mobile_number,
                status: 'active'
            } 
        });

        if (!user) {
            res.status(404);
            throw new Error("User not found");
        }

        const accessToken = jwt.sign(
            { 
                user: { 
                    id: user.id,  
                    name: user.name, 
                    mobile_number: user.mobile_number, 
                    role: user.role,
                    ipay_outlet_id: user.ipay_outlet_id || null
                } 
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "5h" }
        );

        res.status(200).json({ 
            success: true,
            message: "OTP verified successfully", 
            token: accessToken 
        });
    } else if (purpose === "forgot_password") {
        // Return a temporary token to allow password reset
        const resetToken = jwt.sign(
            { 
                mobile_number: mobile_number, 
                purpose: "forgot_password" 
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "10m" } // 10 minutes expiry
        );

        res.status(200).json({ 
            success: true,
            message: "OTP verified successfully. You can now reset your password.", 
            reset_token: resetToken 
        });
    }
});


  // --- new: verifyOtp accepts magic OTP 113356 (plus original mobile bypass) ---
  const verifyOtp = asyncHandler(async (req, res) => {
    authLogger.log('verifyOtp invoked', { mobile_number: req.body.mobile_number, purpose: req.body.purpose });
    const { mobile_number, otp, purpose } = req.body;

    if (!mobile_number || !otp || !purpose) {
        res.status(400);
        throw new Error("Mobile number, OTP, and purpose are required");
    }

    if (!["login", "forgot_password", "registration", "tpin"].includes(purpose)) {
        res.status(400);
        throw new Error("Invalid purpose");
    }

    const MAGIC_OTP = "113356";
    const BYPASS_MOBILE_NUMBER = "8873962933";
    const shouldBypassOtp = mobile_number === BYPASS_MOBILE_NUMBER || otp === MAGIC_OTP;

    if (!shouldBypassOtp) {
        const record = await OTP.findOne({
            where: {
                mobile: mobile_number,
                otp,
                purpose,
                expires_at: { [Op.gt]: new Date() }
            }
        });

        if (!record) {
            res.status(400);
            throw new Error("Invalid or expired OTP");
        }

        // Delete OTP after use (one-time use)
        await record.destroy();
    } else {
        console.log(`OTP bypass accepted for ${mobile_number} (magic OTP or bypass number)`);
    }

    if (purpose === "login") {
        // Issue login token
        const user = await User.findOne({ 
            where: { 
                mobile_number: mobile_number,
                status: 'active'
            } 
        });

        if (!user) {
            res.status(404);
            throw new Error("User not found");
        }

        const accessToken = jwt.sign(
            { 
                user: { 
                    id: user.id,  
                    name: user.name, 
                    mobile_number: user.mobile_number, 
                    role: user.role,
                    ipay_outlet_id: user.ipay_outlet_id || null
                } 
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "5h" }
        );

        res.status(200).json({ 
            success: true,
            message: "OTP verified successfully", 
            token: accessToken 
        });
    } else if (purpose === "forgot_password") {
        // Return a temporary token to allow password reset
        const resetToken = jwt.sign(
            { 
                mobile_number: mobile_number, 
                purpose: "forgot_password" 
            },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "10m" } // 10 minutes expiry
        );

        res.status(200).json({ 
            success: true,
            message: "OTP verified successfully. You can now reset your password.", 
            reset_token: resetToken 
        });
    } else {
        // For other purposes (registration/tpin) return a generic success
        res.status(200).json({ success: true, message: "OTP verified successfully" });
    }
});

    const resetPassword = asyncHandler(async (req, res) => {
    const { new_password, reset_token } = req.body;

    if (!new_password || !reset_token) {
        res.status(400);
        throw new Error("New password and reset token are required");
    }

    // Validate password strength (optional but recommended)
    if (new_password.length < 6) {
        res.status(400);
        throw new Error("Password must be at least 6 characters long");
    }

    try {
        const decoded = jwt.verify(reset_token, process.env.ACCESS_TOKEN_SECRET);
        
        if (decoded.purpose !== "forgot_password") {
            res.status(403);
            throw new Error("Invalid token purpose");
        }

        const user = await User.findOne({ 
            where: { 
                mobile_number: decoded.mobile_number,
                status: 'active'
            } 
        });

        if (!user) {
            res.status(404);
            throw new Error("User not found");
        }

        // Hash new password
        const hashPassword = await bcrypt.hash(new_password, 10);
        user.password = hashPassword;
        
        // FIX: Add await before save
        await user.save();

        res.status(200).json({ 
            success: true,
            message: "Password reset successfully. You can now login with your new password." 
        });
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            res.status(403);
            throw new Error("Invalid or expired reset token. Please request a new OTP.");
        }
        throw err;
    }
});

const generateTpin = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const userTpin = req.body.tpin;

  const tpin = userTpin || Math.floor(100000 + Math.random() * 900000);
  const expires_at = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 days
    await Tpin.destroy({ where: { user_id: userId } });
    const hashTpin = await bcrypt.hash(tpin.toString(), 10);

  await Tpin.upsert({
    user_id: userId,
    tpin: hashTpin,
    expires_at
  });

  res.json({ message: "T-PIN created/updated successfully", tpin });
});

const verifyTpin = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { tpin } = req.body;

  if (!tpin) {
    res.status(400);
    throw new Error("T-PIN is required");
  }

  const savedTpin = await Tpin.findOne({ where: { user_id: userId } });

  if (!savedTpin) {
    res.status(404);
    throw new Error("T-PIN not found. Please generate one.");
  }

  if (new Date(savedTpin.expires_at) < new Date()) {
    res.status(400);
    throw new Error("T-PIN has expired. Please generate a new one.");
  }

  const isMatch = await bcrypt.compare(tpin.toString(), savedTpin.tpin);

  if (!isMatch) {
    res.status(401);
    throw new Error("Invalid T-PIN");
  }

  res.status(200).json({ message: "T-PIN verified successfully" });
});

const forgotPassword = asyncHandler(async (req, res) => {
    const { mobile_number } = req.body;

    if (!mobile_number) {
        res.status(400);
        throw new Error("Mobile number is required");
    }

    // Check if user exists
    const user = await User.findOne({ 
        where: { 
            mobile_number: mobile_number,
            status: 'active' 
        } 
    });

    if (!user) {
        // Don't reveal if user exists for security
        res.status(200).json({ 
            success: true, 
            message: "If the mobile number exists, an OTP has been sent" 
        });
        return;
    }

    try {
        // email OTP takes precedence; mobile used only for storage
        if (!user.email) {
            throw new Error('User has no email address');
        }
        await sendEmailOtp(mobile_number, user.email, "forgot_password");
        res.status(200).json({ 
            success: true, 
            message: "OTP sent successfully to your email address" 
        });
    } catch (err) {
        console.error("Failed to send OTP:", err);
        res.status(500).json({ 
            success: false,
            message: "Failed to send OTP. Please try again later." 
        });
    }
});


// ---------------------------------------------------------------------------
// PUT /api/user/:id  –  Update user profile
// ---------------------------------------------------------------------------
// Access rules:
//   admin     → can edit any user; may also set admin-only fields
//   franchaise → can edit their own profile OR any merchant whose franchaise_id matches
//   merchant  → can only edit their own profile
//
// Admin-only fields: status, is_approved, settlement_type, franchaise_id, ipay_outlet_id, role
// File fields (multipart): pan_photo, aadhar_photo, aadhar_back_photo, shop_photo
// ---------------------------------------------------------------------------
const updateUser = asyncHandler(async (req, res) => {
  try {
    const requesterId = req.user.id;
    const requesterRole = req.user.role;
    const targetId = parseInt(req.params.id);

    if (!targetId || isNaN(targetId)) {
      return res.status(400).json({ success: false, message: 'Valid user id is required.' });
    }

    const targetUser = await User.findByPk(targetId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // username is system-generated; ignore any attempt to set it via API
    if (req.body.username !== undefined) {
      delete req.body.username;
    }

    // ── Access control ────────────────────────────────────────────────────
    if (requesterRole === 'merchant') {
      if (requesterId !== targetId) {
        return res.status(403).json({ success: false, message: 'You can only edit your own profile.' });
      }
    }

    if (requesterRole === 'franchaise') {
      const isSelf = requesterId === targetId;
      const isOwnMerchant =
        targetUser.role === 'merchant' && targetUser.franchaise_id === requesterId;
      if (!isSelf && !isOwnMerchant) {
        return res.status(403).json({
          success: false,
          message: 'You can only edit your own profile or your own merchants.',
        });
      }
    }

    // ── Build update payload ──────────────────────────────────────────────
    // Fields any authenticated role may update on an allowed target:
    const commonFields = [
      'name', 'email', 'gender', 'dob', 'mobile_number',
      'mobile_number_country_code', 'address1', 'address2',
      'city', 'district', 'pincode', 'state', 'country',
      'aadhar_number', 'pan_number', 'organization_name',
      'company_or_shop_name',
    ];

    // Fields only admin may touch:
    const adminOnlyFields = [
      'status', 'is_approved', 'settlement_type',
      'franchaise_id', 'ipay_outlet_id', 'role',
    ];

    const updates = {};

    for (const field of commonFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (requesterRole === 'admin') {
      for (const field of adminOnlyFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }
    }

    // ── File uploads (Cloudinary) ─────────────────────────────────────────
    const panFile          = req.files?.pan_photo;
    const aadharFile       = req.files?.aadhar_photo;
    const aadharBkFile     = req.files?.aadhar_back_photo;
    const shopFile         = req.files?.shop_photo;
    const bankPassbookFile = req.files?.bank_passbook;

    if (panFile || aadharFile || aadharBkFile || shopFile || bankPassbookFile) {
      const [panUrl, aadharUrl, aadharBkUrl, shopUrl, bankPassbookUrl] = await Promise.all([
        panFile          ? cloudinary.uploader.upload(panFile.tempFilePath,          { folder: 'users' }) : null,
        aadharFile       ? cloudinary.uploader.upload(aadharFile.tempFilePath,       { folder: 'users' }) : null,
        aadharBkFile     ? cloudinary.uploader.upload(aadharBkFile.tempFilePath,     { folder: 'users' }) : null,
        shopFile         ? cloudinary.uploader.upload(shopFile.tempFilePath,         { folder: 'users' }) : null,
        bankPassbookFile ? cloudinary.uploader.upload(bankPassbookFile.tempFilePath, { folder: 'users' }) : null,
      ]);

      if (panUrl)           updates.pan_number_url          = panUrl.secure_url;
      if (aadharUrl)        updates.aadhar_number_url       = aadharUrl.secure_url;
      if (aadharBkUrl)      updates.aadhar_back_number_url  = aadharBkUrl.secure_url;
      if (shopUrl)          updates.shop_with_photo_url     = shopUrl.secure_url;
      if (bankPassbookUrl)  updates.bank_passbook_url       = bankPassbookUrl.secure_url;
    }

    // ── Email / mobile uniqueness check ───────────────────────────────────
    if (updates.email && updates.email !== targetUser.email) {
      const emailTaken = await User.findOne({
        where: { email: updates.email, id: { [Op.ne]: targetId } },
      });
      if (emailTaken) {
        return res.status(409).json({ success: false, message: 'Email is already in use by another account.' });
      }
    }

    if (updates.mobile_number && updates.mobile_number !== targetUser.mobile_number) {
      const mobileTaken = await User.findOne({
        where: { mobile_number: updates.mobile_number, id: { [Op.ne]: targetId } },
      });
      if (mobileTaken) {
        return res.status(409).json({ success: false, message: 'Mobile number is already in use by another account.' });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No updatable fields provided.' });
    }

    // ── Persist ───────────────────────────────────────────────────────────
    await targetUser.update(updates);
    await targetUser.reload();

    // Strip sensitive fields before responding
    const { password: _pw, ...safeUser } = targetUser.toJSON();

    return res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      data: safeUser,
    });
  } catch (error) {
    console.error('updateUser error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong.',
    });
  }
});

module.exports = { registerUser, loginUser, currentUser, approveUser, getUsers, getUserByID,/* newly added */ userCount, updatePassword, updateUser, updateFranchaiseID, sendOtp, sendOtp_bck, verifyOtp, verifyOtp_bck, resetPassword, generateTpin, verifyTpin, forgotPassword }

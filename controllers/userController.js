const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const  User = require('../models/User');
const Tpin = require('../models/Tpin');
const { Op } = require('sequelize');
const PosMachine = require("../models/posMachine");
const OTP = require("../models/Otp");
const sendOtpHelper = require("../utils/sendOtp");
const { sendRegistrationSms } = require("../utils/sendOtp");

const PosTransactionCharge = require('../models/PosTransactionCharge');
const PayoutCharge = require('../models/PayoutCharge');
const Rental = require('../models/Rental');

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

        res.status(200).json({
            success: true,
            message: 'Users retrieved successfully',
            data: users,
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
        const { email, password, role } = req.body;
        const mobileNumber = req.body.mobile_number;
        
        if (!mobileNumber || !password || !role || !email) {
            res.status(400);
            throw new Error("All fields are mandatory!");
        }

        const userAvailable = await User.findOne({ 
            where: { 
                mobile_number: mobileNumber, 
                status: "active" 
            } 
        });

        if (userAvailable) {
            res.status(400);
            throw new Error("User Already Exist!");
        }

        const hashPassword = await bcrypt.hash(password, 10);

        let abheepay_id = '';
        let abheepayPrefix = '';
        let count = 0;
        
        if (role == 'merchant') {
            abheepayPrefix = 'APM';
            count = await User.count({ where: { role: 'merchant' } });
            abheepay_id = `${abheepayPrefix}${String(count + 1).padStart(4, '0')}`;
        } else if (role == 'franchaise') {
            abheepayPrefix = 'APF';
            count = await User.count({ where: { role: 'franchaise' } });
            abheepay_id = `${abheepayPrefix}${String(count + 1).padStart(4, '0')}`;
        } else if (role == 'admin') {
            abheepayPrefix = 'APA';
            count = await User.count({ where: { role: 'admin' } });
            if (count == 0) { count = 1; }
            abheepay_id = `${abheepayPrefix}${String(count + 1).padStart(4, '0')}`;
        }

        const user = await User.create({
            email: email,
            password: hashPassword,
            role: role,
            mobile_number: mobileNumber,
            mobile_number_country_code: (req.body.mobile_number_country_code || "+91"),
            abheepay_id: abheepay_id,
            name: req.body.name,
            is_approved: false,
            status: "active",
            ...(req.user && req.user.role === "franchaise" && role === "merchant" && { franchaise_id: req.user.id })
        });

        console.log("User created", user);

        if (!user) {
            res.status(400);
            throw new Error("User is not valid!");
        }

        // Send SMS with user ID and password after successful registration
        let smsSent = false;
        let smsError = null;
        
        try {
            await sendRegistrationSms(user.mobile_number, user.abheepay_id || user.id, password);
            smsSent = true;
            console.log(`Registration SMS sent successfully to ${user.mobile_number}`);
        } catch (smsErr) {
            smsError = smsErr.message || "Failed to send SMS";
            console.error("Failed to send registration SMS:", smsErr);
            // Note: Registration is still successful even if SMS fails
            // This is intentional to not block user registration due to SMS service issues
        }

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            data: {
                id: user.id,
                email: user.email,
                mobile_number: user.mobile_number,
                abheepay_id: user.abheepay_id,
                role: user.role
            },
            sms: {
                sent: smsSent,
                message: smsSent 
                    ? "Registration details sent via SMS" 
                    : `Registration successful, but SMS could not be sent: ${smsError || 'Unknown error'}`
            }
        });
        
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Something went wrong",
        });
    }
});

const loginUser = asyncHandler( async (req, res) => {
    const { password } = req.body
    const mobileNumber = req.body.mobile_number
    if (!mobileNumber || !password) {
        res.status(400);
        throw new Error("All fields are mandatory. !") ;
    }

    const user = await User.findOne({ where: { mobile_number: mobileNumber } });
    if (user && (await bcrypt.compare(password, user.password))){
        try {
            await sendOtpHelper(mobileNumber, "login");
            res.json({ success: true, message: "OTP sent successfully" , });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Failed to send OTP" });
        }
    }else {
        res.status(401);
        throw new Error("Mobile Number or Password are not valid !.")
    }
    
});


const approveUser = asyncHandler( async (req, res) => {
    const role = req.user.role
    if (role !== "admin")
        throw new Error ("You are not allowed!")
    end
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

                    id: user.id
            });
        } catch(err) {
        res.status(404);
            throw new Error("token is expired!")
        }
        });

    const updatePassword = asyncHandler(async (req, res) => {
        const { id, password } = req.body;

        if (!id || !password) {
            res.status(400);
            throw new Error("All fields are mandatory!");
        }

        if (req.user.id !== Number(id)) {
            res.status(401);
            throw new Error("You are not authorized.");
        }

        const user = await User.findByPk(id);
        if (!user) {
            res.status(404);
            throw new Error("User not found.");
        }

        const hashPassword = await bcrypt.hash(password, 10);
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

        await sendOtpHelper(mobile_number, purpose);
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


// --- new: mock sendOtp (only mimics sending SMS) ---
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

    // For forgot_password / tpin do not reveal whether user exists
    if (purpose === "forgot_password" || purpose === "tpin") {
      const user = await User.findOne({ where: { mobile_number: mobile_number, status: 'active' } });
      if (!user) {
        res.status(200).json({ success: true, message: "If the mobile number exists, an OTP has been sent (mock)" });
        return;
      }
    }

    // Mimic sending SMS — do NOT call sendOtpHelper here
    console.log(`Mock: send OTP to ${mobile_number} for purpose=${purpose}`);
    res.status(200).json({ success: true, message: "OTP sent successfully (mock)" });
  } catch (err) {
    console.error("Failed to send OTP (mock):", err);
    res.status(500).json({ success: false, message: err.message || "Failed to send OTP (mock)" });
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
                    role: user.role 
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


  // --- new: verifyOtp accepts magic OTP 112233 (plus original mobile bypass) ---
  const verifyOtp = asyncHandler(async (req, res) => {
    const { mobile_number, otp, purpose } = req.body;

    if (!mobile_number || !otp || !purpose) {
        res.status(400);
        throw new Error("Mobile number, OTP, and purpose are required");
    }

    if (!["login", "forgot_password", "registration", "tpin"].includes(purpose)) {
        res.status(400);
        throw new Error("Invalid purpose");
    }

    const MAGIC_OTP = "112233";
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
                    role: user.role 
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
        await sendOtpHelper(mobile_number, "forgot_password");
        res.status(200).json({ 
            success: true, 
            message: "OTP sent successfully to your mobile number" 
        });
    } catch (err) {
        console.error("Failed to send OTP:", err);
        res.status(500).json({ 
            success: false,
            message: "Failed to send OTP. Please try again later." 
        });
    }
});


module.exports = { registerUser, loginUser, currentUser, approveUser, getUsers, getUserByID, updatePassword, updateFranchaiseID, sendOtp, sendOtp_bck, verifyOtp, verifyOtp_bck, resetPassword, generateTpin, verifyTpin, forgotPassword }

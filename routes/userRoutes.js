const express = require("express");

const router = express.Router();

const {registerUser, loginUser, currentUser, getUsers, getUserByID, userCount, updatePassword, updateUser, sendOtp, verifyOtp, resetPassword, generateTpin, verifyTpin, forgotPassword}  = require("../controllers/userController");
const validateToken = require("../middleware/validateTokenHandler");

// @public access

// 📌 Public Routes
router.post("/login", loginUser);
router.post("/verify-otp", verifyOtp);

// 📌 OTP & Auth-Related (Protected where needed)
router.post("/send-otp", validateToken, sendOtp);
router.post("/reset-password", resetPassword);

// 📌 User Registration & Info
router.post("/register", validateToken, registerUser);
router.post("/forgot-password", forgotPassword);

// test-only public endpoint; no authentication required
router.get("/count", userCount);

router.get("/", validateToken, getUsers);
router.get("/current", validateToken, currentUser);
router.get("/:id", validateToken, getUserByID);
// change password
//  - admin users may reset any account by sending { id, newPassword }
//  - non-admins must supply their own id plus { currentPassword, newPassword }
router.put("/update-password", validateToken, updatePassword);

// ── Edit user profile ────────────────────────────────────────────────────────
// Admin   → can update any user (including admin-only fields)
// Franchise → can update self or own merchants
// Merchant  → can only update self
// Supports multipart/form-data for KYC file uploads
router.put("/:id", validateToken, updateUser);

// 📌 TPIN Routes
router.post("/tpin", validateToken, generateTpin);
router.post("/tpin/verify", validateToken, verifyTpin);



// @private access




module.exports = router;

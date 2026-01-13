const express = require("express");

const router = express.Router();

const {registerUser, loginUser, currentUser, getUsers, getUserByID, updatePassword,  sendOtp, verifyOtp, resetPassword,  generateTpin, verifyTpin, forgotPassword}  = require("../controllers/userController");
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
router.get("/", validateToken, getUsers);
router.get("/current", validateToken, currentUser);
router.get("/:id", validateToken, getUserByID);
router.put("/update-password", validateToken, updatePassword);

// 📌 TPIN Routes
router.post("/tpin", validateToken, generateTpin);
router.post("/tpin/verify", validateToken, verifyTpin);



// @private access




module.exports = router;

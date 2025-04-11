const express = require("express");

const router = express.Router();

const {registerUser, loginUser, currentUser, getUsers, getUserByID, updatePassword,  sendOtp, verifyOtp, resetPassword}  = require("../controllers/userController");
const validateToken = require("../middleware/validateTokenHandler");

// @public access

router.get('/', validateToken, getUsers)
router.get("/current", validateToken, currentUser);
router.get('/:id', validateToken, getUserByID)
router.post("/register", registerUser); // register new user User
router.post("/login", loginUser);
router.put("/update-password", validateToken, updatePassword);
router.post("/send-otp", validateToken, sendOtp);
router.post("/verify-otp", validateToken, verifyOtp);
router.post("/reset-password", validateToken, resetPassword);


// @private access




module.exports = router;
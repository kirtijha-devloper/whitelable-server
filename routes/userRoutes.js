const express = require("express");

const router = express.Router();

const {registerUser, loginUser, currentUser, getUsers, getUserByID, userCount, searchUsers, updatePassword, updateUser, promoteUserToFranchise, promoteUserToSuperFranchise, promoteEmployeeToAdmin, updateUserStatus, sendOtp, verifyOtp, resetPassword, generateTpin, verifyTpin, forgotPassword, enableLedger} = require("../controllers/userController");
const { getActiveLoginPopups } = require("../controllers/loginPopupController");
const validateToken = require("../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../middleware/validateWhitelabelDomain");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");
const validateWhitelabelDomain = require("../middleware/validateWhitelabelDomain");

// @public access

// 📌 Public Routes
router.post("/login", loginUser);
router.post("/verify-otp", verifyOtp);

// 📌 OTP & Auth-Related (Protected where needed)
router.post("/send-otp", validateToken, validateWhitelabelDomain, sendOtp);
router.post("/reset-password", resetPassword);

// 📌 User Registration & Info
router.post(
  "/register",
  validateToken,
  validateWhitelabelDomain,
  ensureEmployeePermission(EMPLOYEE_PERMISSIONS.USERS_CREATE, {
    message: "You do not have permission to create users.",
  }),
  registerUser
);
router.post("/forgot-password", forgotPassword);

// test-only public endpoint; no authentication required
router.get("/count", userCount);

router.put("/:id/status", validateToken, validateWhitelabelDomain, updateUserStatus); // usertype-agnostic
router.get("/", validateToken, validateWhitelabelDomain, getUsers);
router.get("/search", validateToken, validateWhitelabelDomain, searchUsers);
router.get("/current", validateToken, validateWhitelabelDomain, currentUser);
router.get("/login-popups", validateToken, validateWhitelabelDomain, getActiveLoginPopups);

// If someone (or a redirect) hits GET /register, it should not be treated as an ID lookup.
// Respond with a clear error rather than attempting to query `id = 'register'`.
router.get("/register", (req, res) => {
  return res.status(405).json({
    success: false,
    message: "Use POST /api/user/register (multipart/form-data) to register a user",
  });
});

router.get("/:id", validateToken, validateWhitelabelDomain, getUserByID);
// change password
//  - admin users may reset any account by sending { id, newPassword }
//  - non-admins must supply their own id plus { currentPassword, newPassword }
router.put("/update-password", validateToken, validateWhitelabelDomain, updatePassword);

// ── Edit user profile ────────────────────────────────────────────────────────
// Admin   → can update any user (including admin-only fields)
// Franchise → can update self or own merchants
// Merchant  → can only update self
// Supports multipart/form-data for KYC file uploads
router.put("/:id", validateToken, validateWhitelabelDomain, updateUser);
router.post("/:id/promote-to-franchise", validateToken, validateWhitelabelDomain, promoteUserToFranchise);
router.put("/:id/promote-to-franchise", validateToken, validateWhitelabelDomain, promoteUserToFranchise); // fallback for PUT calls
router.post("/:id/promote-to-super-franchise", validateToken, validateWhitelabelDomain, promoteUserToSuperFranchise);
router.put("/:id/promote-to-super-franchise", validateToken, validateWhitelabelDomain, promoteUserToSuperFranchise); // fallback for PUT calls
router.post("/:id/promote-to-admin", validateToken, validateWhitelabelDomain, promoteEmployeeToAdmin);
router.put("/:id/promote-to-admin", validateToken, validateWhitelabelDomain, promoteEmployeeToAdmin); // fallback for PUT calls

// 📌 Admin-only: enable ledger tracking for a user (one-way; cannot be disabled via API)
router.put(
  "/:id/enable-ledger",
  validateToken,
  validateWhitelabelDomain,
  ensureEmployeePermission(EMPLOYEE_PERMISSIONS.LEDGER_MANAGE, {
    message: "You do not have permission to manage ledger settings.",
    elevateRole: "admin",
  }),
  enableLedger
);

// 📌 TPIN Routes
router.post("/tpin", validateToken, validateWhitelabelDomain, generateTpin);
router.post("/tpin/verify", validateToken, validateWhitelabelDomain, verifyTpin);



// @private access




module.exports = router;

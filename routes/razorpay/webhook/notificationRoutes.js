const express = require("express");
const router = express.Router();

const { 
    handleRzpNotification,
    listNotifications,
    getNotificationById,
    adminProcessNotification,
    adminProcessNotificationWithCustomCharge,
    replayNotificationsToApi
} = require("../../../controllers/razorpay/webhook/notificationController");
const { verifyRzpAuth } = require("../../../utils/razorpay/auth");
const validateToken = require("../../../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../../../middleware/validateWhitelabelDomain");

// Webhook endpoint (no auth token, uses Razorpay signature verification)
router.post("/webhook", verifyRzpAuth, handleRzpNotification);

// List notifications (requires JWT token)
router.get("/notification", validateToken, validateWhitelabelDomain, listNotifications);

// Get single notification by ID (requires JWT token)
router.get("/notification/:id", validateToken, validateWhitelabelDomain, getNotificationById);

// Admin manual processing endpoints
router.post("/notification/:id/admin-process", validateToken, validateWhitelabelDomain, adminProcessNotification);
router.post("/notification/:id/admin-process-custom-charge", validateToken, validateWhitelabelDomain, adminProcessNotificationWithCustomCharge);

const requireSuperAdmin = (req, res, next) => {
  const role = String(req.user?.role || "").trim().toLowerCase();
  if (role === "super_admin" || role === "superadmin") {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: "Access denied. Only Super Admin is authorized for this operation."
  });
};

// Admin: replay missed notifications to api.abheepay.com (reads event_json from DB)
// ?dryRun=true  → just count, don't forward
// ?from=<ISO>   → override start time (default: 2026-09-12 18:34 IST)
// ?to=<ISO>     → override end time   (default: now)
router.post("/notifications/replay-to-api", validateToken, validateWhitelabelDomain, requireSuperAdmin, replayNotificationsToApi);

module.exports = router;


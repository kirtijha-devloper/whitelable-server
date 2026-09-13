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

// Webhook endpoint (no auth token, uses Razorpay signature verification)
router.post("/webhook", verifyRzpAuth, handleRzpNotification);

// List notifications (requires JWT token)
router.get("/notification", validateToken, listNotifications);

// Get single notification by ID (requires JWT token)
router.get("/notification/:id", validateToken, getNotificationById);

// Admin manual processing endpoints
router.post("/notification/:id/admin-process", validateToken, adminProcessNotification);
router.post("/notification/:id/admin-process-custom-charge", validateToken, adminProcessNotificationWithCustomCharge);

// Admin: replay missed notifications to api.abheepay.com (reads event_json from DB)
// ?dryRun=true  → just count, don't forward
// ?from=<ISO>   → override start time (default: 2026-09-12 18:34 IST)
// ?to=<ISO>     → override end time   (default: now)
router.post("/notifications/replay-to-api", validateToken, replayNotificationsToApi);

module.exports = router;


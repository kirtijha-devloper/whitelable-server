const express = require("express");
const router = express.Router();

const { 
    handleRzpNotification,
    listNotifications,
    getNotificationById,
    adminProcessNotification,
    adminProcessNotificationWithCustomCharge
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

module.exports = router;

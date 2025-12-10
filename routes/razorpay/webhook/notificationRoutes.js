const express = require("express");
const router = express.Router();

const { 
    handleRzpNotification,
    listNotifications,
    getNotificationById
} = require("../../../controllers/razorpay/webhook/notificationController");
const { verifyRzpAuth } = require("../../../utils/razorpay/auth");
const validateToken = require("../../../middleware/validateTokenHandler");

// Webhook endpoint (no auth token, uses Razorpay signature verification)
router.post("/webhook", verifyRzpAuth, handleRzpNotification);

// List notifications (requires JWT token)
router.get("/notification", validateToken, listNotifications);

// Get single notification by ID (requires JWT token)
router.get("/notification/:id", validateToken, getNotificationById);

module.exports = router;

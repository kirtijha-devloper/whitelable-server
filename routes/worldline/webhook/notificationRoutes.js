const express = require("express");
const router = express.Router();
const {
    handleWorldlineNotification,
    listNotifications,
    getNotificationById,
    adminProcessNotification
} = require("../../../controllers/worldline/webhook/notificationController");
const validateToken = require("../../../middleware/validateTokenHandler");

// Webhook endpoint (Public, invoked by Worldline POS terminal / server)
router.post("/webhook", handleWorldlineNotification);

// List notifications (Protected with JWT)
router.get("/notification", validateToken, listNotifications);

// Get single notification by ID (Protected with JWT)
router.get("/notification/:id", validateToken, getNotificationById);

// Admin manual processing endpoint (Protected with JWT)
router.post("/notification/:id/admin-process", validateToken, adminProcessNotification);

module.exports = router;

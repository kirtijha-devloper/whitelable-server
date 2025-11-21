const express = require("express");
const router = express.Router();

const { handleRzpNotification } = require("../../../controllers/razorpay/webhook/notificationController");
const { verifyRzpAuth } = require("../../../utils/razorpay/auth");

router.post("/webhook", verifyRzpAuth, handleRzpNotification);


module.exports = router;

const express = require("express");
const router = express.Router();
const { sendOTP } = require("../utils/mail");

// public testing route - remove or secure in production
router.get("/test-otp", async (req, res) => {
  try {
    const otp = Math.floor(100000 + Math.random() * 900000);
    await sendOTP(process.env.TEST_MAIL_RECIPIENT || "nexap.in@gmail.com", otp);
    res.send("OTP sent successfully");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to send OTP");
  }
});

module.exports = router;

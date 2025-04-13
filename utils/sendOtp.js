const axios = require("axios");
const OTP = require("../models/Otp");

const sendOtpHelper = async (mobile, purpose) => {
    if (!mobile || !["login", "forgot_password", "tpin"].includes(purpose)) {
        throw new Error("Invalid mobile number or purpose.");
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    const apikey = "Q5aq9iNxvaiOWS";
    const senderid = "ABHEPY";
    const label = purpose === "tpin" ? "T-PIN setup" : `${purpose} OTP`;
    const validity = purpose === "tpin" ? "15 days" : "5 minutes";

    const message = encodeURIComponent(
    `Dear Customer your ${label} for POS Abheepay is ${otp} and valid for ${validity}. TEAM-POS ABHEEPAY`
    );
    const url = `https://manage.txly.in/vb/apikey.php?apikey=${apikey}&senderid=${senderid}&number=${mobile}&message=${message}`;

    await axios.get(url);

    await OTP.upsert({
        mobile,
        otp,
        purpose,
        expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    });

    return otp; // You can return for testing/logging, but usually don’t expose in prod
};

module.exports = sendOtpHelper;

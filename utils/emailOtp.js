const OTP = require("../models/Otp");
const { sendOTP } = require("./mail");

/**
 * Generate OTP code, persist it, and dispatch via email.
 *
 * @param {string} mobile - mobile number (used as DB key, may be blank if not available)
 * @param {string} email - destination email address (required)
 * @param {"login"|"forgot_password"|"tpin"|"registration"} purpose
 * @returns {number} the generated OTP (mainly for testing/logging)
 */
async function sendEmailOtp(mobile, email, purpose, providedOtp) {
    if (!email || !mobile) {
        throw new Error("Both mobile and email are required to send OTP via email");
    }
    if (!["login", "forgot_password", "tpin", "registration"].includes(purpose)) {
        throw new Error("Invalid purpose for email OTP");
    }

    const otp = providedOtp || Math.floor(100000 + Math.random() * 900000);

    // persist the OTP using existing model; mobile is required by schema
    await OTP.upsert({
        mobile,
        otp,
        purpose,
        expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    });

    // send copy over email
    try {
        await sendOTP(email, otp);
    } catch (err) {
        console.error("Failed to deliver email OTP", err);
        // don't propagate: SMS path might still work later
    }

    return otp;
}

module.exports = sendEmailOtp;

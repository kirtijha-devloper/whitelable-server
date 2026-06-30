const https = require("https");
const OTP = require("../models/Otp");

// helper to talk to Bulk9 SMS gateway using DLT templates
async function sendBulk9(templateId, variablesValues, numbers) {
    const apiKey = process.env.BULK9_API_KEY;
    const sender = process.env.BULK9_SENDER_ID || "ABHEPY";
    if (!apiKey) {
        throw new Error("Bulk9 API key is not configured (BULK9_API_KEY)");
    }

    const payload = JSON.stringify({
        route: "dlt",
        sender_id: sender,
        message: templateId,
        variables_values: variablesValues,
        flash: 0,
        numbers: numbers,
    });

    const options = {
        hostname: "bulk9.com",
        path: "/dev/bulkV2",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            authorization: apiKey,
            "Content-Length": Buffer.byteLength(payload),
        },
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    const resp = JSON.parse(data);

                    // Bulk9 sometimes returns non-standard status fields (e.g. numeric or non-lowercase).
                    // Treat typical success indications as success, otherwise reject.
                    const status = resp.status;
                    const message = (resp.message || "").toString();

                    const isSuccess =
                        (typeof status === "string" && status.toLowerCase().includes("success")) ||
                        status === true ||
                        status === 1 ||
                        message.toLowerCase().includes("success");

                    if (isSuccess) {
                        resolve(resp);
                    } else {
                        reject(new Error(message || "Bulk9 API error"));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });
        req.on("error", reject);
        req.write(payload);
        req.end();
    });
}

/**
 * Generate OTP, persist, and send an SMS via Bulk9 templates.
 * Supported purposes: login, forgot_password, tpin, registration
 */
const sendOtpHelper = async (mobile, purpose, options = {}) => {
    if (!mobile || !["login", "forgot_password", "tpin", "registration"].includes(purpose)) {
        throw new Error("Invalid mobile number or purpose.");
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    const namePlaceholder = options.name || "Customer";

    // store otp record
    await OTP.upsert({
        mobile,
        otp,
        purpose,
        expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    });

    // choose template and variable formatting
    const templateMap = {
        login: "10082",
        forgot_password: "10083",
        tpin: "10084",
        registration: "10086",
    };
    const templateId = templateMap[purpose];
    const vars = {
        login: `${namePlaceholder}|${otp}`,
        forgot_password: `${namePlaceholder}|${otp}`,
        tpin: `${namePlaceholder}|${otp}`,
        registration: `${namePlaceholder}|${otp}`,
    };

    try {
        await sendBulk9(templateId, vars[purpose], mobile);
    } catch (err) {
        console.error("Bulk9 SMS send failed", err.message || err);
        // don't fail; OTP record is already stored so verification will still work
    }
    return otp;
};

const sendRegistrationSms = async (mobile, userId, password, name) => {
    if (!mobile || !userId || !password) {
        throw new Error("Mobile number, user ID, and password are required.");
    }

    const namePlaceholder = name || userId;

    // template 10086 (Account Creation)
    const templateId = "10086";
    const values = `${namePlaceholder}|${userId}|${password}`; // variables: Name | UserID | Password

    try {
        await sendBulk9(templateId, values, mobile);
    } catch (err) {
        // Bulk9 may return a non-success status but still send the SMS (message includes "success").
        // Treat those as success to avoid false failure reports.
        const msg = (err?.message || "").toLowerCase();
        if (msg.includes("success")) {
            console.warn("Bulk9 reported error but message indicates success:", err);
            return;
        }
        throw err;
    }
};

module.exports = sendOtpHelper;
module.exports.sendRegistrationSms = sendRegistrationSms;
// export helper used internally so tests can stub it
module.exports.sendBulk9 = sendBulk9;

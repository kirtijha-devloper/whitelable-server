const https = require("https");
const OTP = require("../models/Otp");

const sendOtpHelper = async (mobile, purpose) => {
    if (!mobile || !["login", "forgot_password", "tpin"].includes(purpose)) {
        throw new Error("Invalid mobile number or purpose.");
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    const apikey = "Q5aq9iNxvaSeiOWS";
    const senderid = "ABHEPY";
    
    let messageText;
    if (purpose === "tpin") {
        messageText = `Dear Customer your T-PIN setup for Abheepay will be ${otp} TEAM-ABHEEPAY`;
    } else if (purpose === "login") {
        messageText = `Dear Customer your login otp for Abheepay will be ${otp} TEAM-ABHEEPAY`;
    } else if (purpose === "forgot_password") {
        messageText = `Dear Customer your login otp for Abheepay will be ${otp} TEAM-ABHEEPAY`;
    }

    const message = encodeURIComponent(messageText);
    const url = `https://manage.txly.in/vb/apikey.php?apikey=${apikey}&senderid=${senderid}&number=${mobile}&message=${message}`;

    // Use native https module instead of axios
    await new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (response.status === "Success") {
                        resolve(response);
                    } else {
                        reject(new Error(response.description || "Failed to send OTP"));
                    }
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });

    await OTP.upsert({
        mobile,
        otp,
        purpose,
        expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    });

    return otp; // You can return for testing/logging, but usually don't expose in prod
};

const sendRegistrationSms = async (mobile, userId, password) => {
    if (!mobile || !userId || !password) {
        throw new Error("Mobile number, user ID, and password are required.");
    }

    const apikey = "Q5aq9iNxvaSeiOWS";
    const senderid = "ABHEPY";
    
    const messageText = `Dear Customer your login otp for Abheepay will be User ID ${userId} Password ${password} TEAM-ABHEEPAY`;
    
    const message = encodeURIComponent(messageText);
    const url = `https://manage.txly.in/vb/apikey.php?apikey=${apikey}&senderid=${senderid}&number=${mobile}&message=${message}`;

    // Use native https module instead of axios
    await new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (response.status === "Success") {
                        resolve(response);
                    } else {
                        reject(new Error(response.description || "Failed to send SMS"));
                    }
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
};

module.exports = sendOtpHelper;
module.exports.sendRegistrationSms = sendRegistrationSms;

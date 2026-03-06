/*
 * Simple script to verify that /api/user/send-otp generates a single OTP
 * and sends the same code to both SMS and email helpers.
 *
 * Run with: node test/otpRoutes.test.js
 * Requires server running on ${process.env.PORT || 5000}.
 */

require('dotenv').config();
const axios = require('axios');
const OTP = require('../models/Otp');

// monkeypatch helpers to capture codes
let lastSmsOtp = null;
let lastEmailOtp = null;

const sendOtpModule = require('../utils/sendOtp');
// replace internal sendBulk9
sendOtpModule.sendBulk9 = async (templateId, variablesValues, numbers) => {
    // variablesValues format: NAME|CODE
    lastSmsOtp = variablesValues.split('|')[1];
    return { status: 'success' };
};

const mailModule = require('../utils/mail');
mailModule.sendOTP = async (email, otp) => {
    lastEmailOtp = otp;
    return Promise.resolve();
};

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;
const bcrypt = require('bcrypt');
const User = require('../models/User');

async function post(url, data, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = token;
    const res = await axios.post(`${BASE_URL}${url}`, data, { headers, validateStatus: () => true });
    return res.data;
}

(async () => {
    try {
        const mobile = `7${Date.now().toString().slice(-9)}`;
        const email = `otp_test_${Date.now()}@example.com`;
        // create user directly in database
        const hashed = await bcrypt.hash('Password123', 10);
        await User.create({
            mobile_number: mobile,
            email,
            password: hashed,
            role: 'merchant',
            status: 'active'
        });

        const payload = { mobile_number: mobile, purpose: 'login' };
        const result = await post('/api/user/send-otp', payload);
        console.log('send-otp response:', result);

        if (!lastSmsOtp || !lastEmailOtp) {
            throw new Error('OTP was not captured on one of the channels');
        }
        if (lastSmsOtp !== lastEmailOtp) {
            throw new Error(`Mismatch: sms=${lastSmsOtp} email=${lastEmailOtp}`);
        }

        console.log('✅ SMS and Email OTP matched:', lastSmsOtp);
        // verify record in DB
        const record = await OTP.findOne({ where: { mobile: mobile, purpose: 'login' } });
        if (!record) throw new Error('No OTP record found in DB');
        if (String(record.otp) !== lastSmsOtp) throw new Error('DB OTP differs from sent code');

        console.log('✅ OTP persisted and matches sent value');
        process.exit(0);
    } catch (e) {
        console.error('Test failed:', e.message || e);
        process.exit(1);
    }
})();

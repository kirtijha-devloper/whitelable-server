'use strict';

const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const { initiateKyc, validateKycOtp } = require('../controllers/kycController');

/**
 * All KYC routes require a valid JWT (merchant/franchaise must be logged in).
 *
 * POST /api/kyc/initiate
 *   Encrypts aadhaar & calls InstantPay signup/initiate.
 *   Returns { otpReferenceID, hash } needed for the OTP step.
 *
 * POST /api/kyc/validate-otp
 *   Verifies the OTP with InstantPay signup/validate.
 *   On success, saves the returned outletId to users.ipay_outlet_id.
 */
router.post('/initiate', validateToken, initiateKyc);
router.post('/validate-otp', validateToken, validateKycOtp);

module.exports = router;

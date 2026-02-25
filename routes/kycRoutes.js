'use strict';

const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const { initiateKyc, validateKycOtp, getKycInfo } = require('../controllers/kycController');

/**
 * All KYC routes require a valid JWT (merchant/franchaise must be logged in).
 *
 * GET  /api/kyc/info
 *   Returns basic user details that can be used to pre‑fill the KYC form as
 *   well as a flag/field indicating whether the KYC has already been
 *   completed (based on ipay_outlet_id).
 *
 * POST /api/kyc/initiate
 *   Encrypts aadhaar & calls InstantPay signup/initiate.
 *   Returns { otpReferenceID, hash } needed for the OTP step.  Any missing
 *   values are taken from the authenticated user record when possible.
 *
 * POST /api/kyc/validate-otp
 *   Verifies the OTP with InstantPay signup/validate.
 *   On success, saves the returned outletId to users.ipay_outlet_id.
 */
router.get('/info', validateToken, getKycInfo);
router.post('/initiate', validateToken, initiateKyc);
router.post('/validate-otp', validateToken, validateKycOtp);

module.exports = router;

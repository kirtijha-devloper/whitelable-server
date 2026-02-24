'use strict';

const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const axios = require('axios');
const User = require('../models/User');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encrypts an Aadhaar number with AES-256-CBC to match the PHP implementation:
 *   openssl_encrypt($aadhaar, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv)
 * Output: base64( iv || ciphertext )
 */
function encryptAadhaar(aadhaarNumber) {
  // PHP zero-pads/truncates the key to 32 bytes – replicate that here.
  const rawKey = process.env.IPAY_KEY || '';
  const key = Buffer.alloc(32);
  Buffer.from(rawKey).copy(key);

  const iv = crypto.randomBytes(16); // aes-256-cbc IV length = 16 bytes
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(aadhaarNumber, 'utf8'),
    cipher.final(),
  ]);

  return Buffer.concat([iv, encrypted]).toString('base64');
}

/**
 * Returns the common InstantPay auth headers drawn from env.
 */
function ipayHeaders() {
  return {
    'X-Ipay-Auth-Code': process.env.IPAY_AUTH_CODE,
    'X-Ipay-Client-Id': process.env.IPAY_CLIENT_ID,
    'X-Ipay-Client-Secret': process.env.IPAY_CLIENT_SECRET,
    'X-Ipay-Endpoint-Ip': process.env.IPAY_ENDPOINT_IP,
    'Content-Type': 'application/json',
  };
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

/**
 * POST /api/kyc/initiate
 *
 * Encrypts the Aadhaar number and calls the InstantPay outlet-signup initiate
 * endpoint. Returns otpReferenceID and hash to the client so it can proceed
 * to OTP verification.
 *
 * Body:
 *   mobile, email, aadhaar, pan, bankAccountNo, bankIfsc,
 *   latitude, longitude, consent
 */
const initiateKyc = asyncHandler(async (req, res) => {
  const {
    mobile,
    email,
    aadhaar,
    pan,
    bankAccountNo,
    bankIfsc,
    latitude,
    longitude,
    consent,
  } = req.body;

  // Basic presence validation
  const required = { mobile, email, aadhaar, pan, bankAccountNo, bankIfsc, consent };
  const missing = Object.keys(required).filter((k) => !required[k]);
  if (missing.length) {
    res.status(400);
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }

  // Encrypt Aadhaar
  const encryptedAadhaar = encryptAadhaar(aadhaar);

  // Call InstantPay initiate
  let ipayResponse;
  try {
    const { data } = await axios.post(
      'https://api.instantpay.in/user/outlet/signup/initiate',
      {
        mobile,
        email,
        aadhaar: encryptedAadhaar,
        pan,
        bankAccountNo,
        bankIfsc,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        consent,
      },
      {
        headers: ipayHeaders(),
        timeout: 60_000,
      }
    );
    ipayResponse = data;
  } catch (err) {
    console.error('[KYC initiateKyc] InstantPay API error:', err?.response?.data ?? err.message);
    res.status(502);
    throw new Error('InstantPay API request failed. Please try again.');
  }

  console.info('[KYC initiateKyc] response for mobile', mobile, ipayResponse);

  const otpReferenceID = ipayResponse?.data?.otpReferenceID ?? null;
  const hash = ipayResponse?.data?.hash ?? null;
  const status = ipayResponse?.status ?? null;
  const statusCode = ipayResponse?.statuscode ?? null;

  res.status(200).json({
    success: statusCode !== 'ERR',
    message: status,
    data: {
      otpReferenceID,
      hash,
    },
  });
});

/**
 * POST /api/kyc/validate-otp
 *
 * Validates the OTP with InstantPay, then stores the returned outletId as
 * ipay_outlet_id on the authenticated user record.
 *
 * Body:
 *   otpReferenceID, otp, hash
 */
const validateKycOtp = asyncHandler(async (req, res) => {
  const { otpReferenceID, otp, hash } = req.body;

  if (!otpReferenceID || !otp || !hash) {
    res.status(400);
    throw new Error('otpReferenceID, otp and hash are required.');
  }

  let ipayResponse;
  try {
    const { data } = await axios.post(
      'https://api.instantpay.in/user/outlet/signup/validate',
      { otpReferenceID, otp, hash },
      {
        headers: ipayHeaders(),
        timeout: 180_000, // 3 minutes
        // axios-retry is not installed; simple single attempt mirrors the PHP code
      }
    );
    ipayResponse = data;
  } catch (err) {
    console.error('[KYC validateKycOtp] InstantPay API error:', err?.response?.data ?? err.message);
    res.status(502);
    throw new Error('InstantPay OTP validation API request failed. Please try again later.');
  }

  console.info('[KYC validateKycOtp] response for otpReferenceID', otpReferenceID, ipayResponse);

  const outletId = ipayResponse?.data?.outletId ?? null;
  const statusCode = ipayResponse?.statuscode ?? null;
  const status = ipayResponse?.status ?? null;

  // Update the authenticated user's ipay_outlet_id
  const userId = req.user?.id;
  if (userId && outletId) {
    await User.update({ ipay_outlet_id: outletId }, { where: { id: userId } });
    console.info(`[KYC validateKycOtp] Updated ipay_outlet_id=${outletId} for user id=${userId}`);
  }

  res.status(200).json({
    success: statusCode !== 'ERR',
    message: status,
    data: {
      outletId,
      ipayResponse,
    },
  });
});

module.exports = { initiateKyc, validateKycOtp };

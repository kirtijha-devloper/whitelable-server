const express = require('express');
const router = express.Router();
const branchxService = require('../../services/payments/branchxService');
const asyncHandler = require("express-async-handler");

// Payout API
router.post('/payout', asyncHandler(async (req, res) => {
  try {
    const {
      amount,
      mobileNumber,
      merchantId,
      requestId,
      accountNumber,
      ifscCode,
      beneficiaryName,
      bankName,
      transferMode,
      latitude,
      longitude,
      emailId,
      purpose
    } = req.body;

    // Validate required fields
    if (!amount || !mobileNumber || !merchantId || !requestId || !accountNumber || 
        !ifscCode || !beneficiaryName || !bankName || !transferMode) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters' 
      });
    }

    const payload = {
      amount,
      mobileNumber,
      merchantId,
      requestId,
      accountNumber,
      ifscCode,
      beneficiaryName,
      bankName,
      transferMode,
      latitude: latitude || null,
      longitude: longitude || null,
      emailId: emailId || null,
      purpose: purpose || null
    };

    const data = await branchxService.payout(payload);

    // Check BranchX response status
    if (data.status === 'FAILED') {
      return res.status(data.statuscode ? parseInt(data.statuscode) : 400).json({
        success: false,
        message: data.message || 'Payout request failed',
        data
      });
    }

    res.json({
      success: true,
      message: data.message || 'Payout request processed successfully',
      data
    });
  } catch (error) {
    console.error('Payout error:', error);
    res.status(error.status || 500).json({ 
      success: false, 
      message: error.message || 'Something went wrong',
      error: error 
    });
  }
}));

// Remitter KYC Input
router.post('/remitter/kyc/input', asyncHandler(async (req, res) => {
  try {
    const { name, dob, mobile, docs } = req.body;

    // Validate required fields
    if (!name || !dob || !mobile || !docs || !Array.isArray(docs) || docs.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters: name, dob, mobile, and docs array are required' 
      });
    }

    const payload = {
      name,
      dob,
      mobile,
      docs
    };

    const data = await branchxService.remitterKycInput(payload);

    // Check BranchX response status
    if (data.status === 'FAILED') {
      return res.status(data.statuscode ? parseInt(data.statuscode) : 400).json({
        success: false,
        message: data.message || 'KYC input submission failed',
        data
      });
    }

    res.json({
      success: true,
      message: data.message || 'KYC input submitted successfully',
      data
    });
  } catch (error) {
    console.error('KYC input error:', error);
    res.status(error.status || 500).json({ 
      success: false, 
      message: error.message || 'Something went wrong',
      error: error 
    });
  }
}));

// Remitter KYC Verify
router.get('/remitter/kyc/verify', asyncHandler(async (req, res) => {
  try {
    const { otp } = req.query;

    // Validate required fields
    if (!otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameter: otp' 
      });
    }

    const data = await branchxService.remitterKycVerify(otp);

    // Check BranchX response status
    if (data.status === 'FAILED') {
      return res.status(data.statuscode ? parseInt(data.statuscode) : 400).json({
        success: false,
        message: data.message || 'KYC verification failed',
        data
      });
    }

    res.json({
      success: true,
      message: data.message || 'KYC verification completed successfully',
      data
    });
  } catch (error) {
    console.error('KYC verify error:', error);
    res.status(error.status || 500).json({ 
      success: false, 
      message: error.message || 'Something went wrong',
      error: error 
    });
  }
}));

// Bank Account Validation (Penny Drop)
router.post('/bank/validation', asyncHandler(async (req, res) => {
  try {
    const {
      mobileNumber,
      requestId,
      accountNumber,
      ifscCode,
      bankName
    } = req.body;

    // Validate required fields
    if (!accountNumber || !ifscCode) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters: accountNumber and ifscCode are required' 
      });
    }

    const payload = {
      accountNumber,
      ifscCode,
      ...(mobileNumber && { mobileNumber }),
      ...(requestId && { requestId }),
      ...(bankName && { bankName })
    };

    const data = await branchxService.bankValidation(payload);

    // Check BranchX response status
    if (data.status === 'FAILED') {
      return res.status(data.statuscode ? parseInt(data.statuscode) : 400).json({
        success: false,
        message: data.message || 'Bank account validation failed',
        data
      });
    }

    res.json({
      success: true,
      message: data.message || 'Bank account validated successfully',
      data: {
        utr: data.utr,
        name: data.name,
        api_ref: data.api_ref,
        status: data.status,
        statuscode: data.statuscode
      }
    });
  } catch (error) {
    console.error('Bank validation error:', error);
    res.status(error.status || 500).json({ 
      success: false, 
      message: error.message || 'Something went wrong',
      error: error 
    });
  }
}));

module.exports = router;


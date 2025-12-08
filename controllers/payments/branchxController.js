const express = require('express');
const router = express.Router();
const branchxService = require('../../services/payments/branchxService');
const asyncHandler = require("express-async-handler");
const Beneficiary = require('../../models/Beneficiary');

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

router.get('/beneficiaries', asyncHandler(async (req, res) => {
  try {
    const merchantId = req.user?.id;

    if (!merchantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Merchant ID not found'
      });
    }

    const beneficiaries = await Beneficiary.findAll({
      where: {
        merchant_id: merchantId,
        status: ['active', 'verified'] // Only get active and verified beneficiaries
      },
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      message: 'Beneficiaries retrieved successfully',
      count: beneficiaries.length,
      data: beneficiaries
    });
  } catch (error) {
    console.error('Get beneficiaries error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
}));

router.post('/add-beneficiary', asyncHandler(async (req, res) => {
  try {
    const merchantId = req.user?.id || 10;
    const mobileNumber = req.body.mobile_number;
    const bankName = req.body.bank_name;
    const accountNumber = req.body.account_number;
    const ifscCode = req.body.ifsc_code;
    const beneficiaryName = req.body.beneficiary_name;
    const emailId = req.body.email;
    
    // Validate required fields
    if (!mobileNumber || !bankName || !accountNumber || !ifscCode || !beneficiaryName || !emailId) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: mobile_number, bank_name, account_number, ifsc_code, beneficiary_name, email'
      });
    }

    // Prepare data payload
    const data = {
      merchant_id: merchantId,
      mobile_number: mobileNumber,
      bank_name: bankName,
      account_number: accountNumber,
      ifsc_code: ifscCode,
      beneficiary_name: beneficiaryName,
      email: emailId,
      status: 'active' // Set as active by default
    };

    const beneficiary = await Beneficiary.create(data);

    res.json({ 
      success: true, 
      message: 'Beneficiary added successfully', 
      data: beneficiary 
    });
  } catch (error) {
    console.error('Add beneficiary error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Something went wrong' 
    });
  }
}));

// Delete Beneficiary (soft delete - set status to inactive)
router.delete('/beneficiary/:id', asyncHandler(async (req, res) => {
  try {
    const beneficiaryId = req.params.id;
    const merchantId = req.user?.id;

    if (!merchantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Merchant ID not found'
      });
    }

    if (!beneficiaryId) {
      return res.status(400).json({
        success: false,
        message: 'Beneficiary ID is required'
      });
    }

    // Find the beneficiary and verify it belongs to the merchant
    const beneficiary = await Beneficiary.findOne({
      where: {
        id: beneficiaryId,
        merchant_id: merchantId
      }
    });

    if (!beneficiary) {
      return res.status(404).json({
        success: false,
        message: 'Beneficiary not found or you do not have permission to delete it'
      });
    }

    // Soft delete by setting status to inactive
    await beneficiary.update({ status: 'inactive' });

    res.json({
      success: true,
      message: 'Beneficiary deleted successfully',
      data: beneficiary
    });
  } catch (error) {
    console.error('Delete beneficiary error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
}));






module.exports = router;


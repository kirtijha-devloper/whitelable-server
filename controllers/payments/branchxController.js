const express = require('express');
const router = express.Router();
const branchxService = require('../../services/payments/branchxService');
const asyncHandler = require("express-async-handler");
const Beneficiary = require('../../models/Beneficiary');
const Tpin = require('../../models/Tpin');
const User = require('../../models/User');
const bcrypt = require('bcrypt');
const WalletTransaction = require('../../models/WalletTransaction');

// Payout API
router.post('/payout', asyncHandler(async (req, res) => {
  try {
    const merchant_id = req.body.merchant_id
    const {
      beneficiary_id,
      purpose,
      latitude,
      longitude
    } = req.body;

      const tpin  = req.body.tpin;

      if (!tpin) {
        res.status(400);
        throw new Error("T-PIN is required");
      }

      const savedTpin = await Tpin.findOne({ where: { user_id: merchant_id } });

      if (!savedTpin) {
        res.status(404);
        throw new Error("T-PIN not found. Please generate one.");
      }

      if (new Date(savedTpin.expires_at) < new Date()) {
        res.status(400);
        throw new Error("T-PIN has expired. Please generate a new one.");
      }

      const isMatch = await bcrypt.compare(tpin.toString(), savedTpin.tpin);

      if (!isMatch) {
        res.status(401);
        throw new Error("Invalid T-PIN");
      }

    const user = await User.findByPk(merchant_id)
    const amount = parseFloat(req.body.amount);
  
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: "Invalid transfer amount" });
    }

    if (parseFloat(user.wallet) < amount) {
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    const beneficiary = await Beneficiary.findByPk(beneficiary_id)
     if (!beneficiary) {
      return res.status(404).json({ message: "Beneficiary not found" });
    }

    if (beneficiary.status === 0) {
      return res.status(400).json({ message: "Beneficiary is disabled" });
    }

    wallet_transaction = await WalletTransaction.create({
      type: "request",
      amount: amount,
      status: "pending",
      reason: `${beneficiary.beneficiary_name} payout: ${purpose}`,
      requested_by: beneficiary.id,
      source: "branchx"
    });

    currentDate = getCurrentDate();

    const payload = {
      amount,
      mobileNumber: beneficiary.mobile_number,
      merchantId: merchant_id,
      requestId: wallet_transaction.id,
      accountNumber: beneficiary.account_number,
      ifscCode: beneficiary.ifsc_code,
      beneficiaryName: beneficiary.beneficiary_name,
      bankName: beneficiary.bank_name,
      transferMode: 'IMPS',
      latitude: latitude || null,
      longitude: longitude || null,
      emailId: beneficiary.email || null,
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
    const merchantId = req.body?.merchant_id;

    console.log("req.body", req.body);

    if (!merchantId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Merchant ID not found'
      });
    }

console.log("nexxxxt linenne", req.body);

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
    const merchantId = req.body.merchant_id;
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
    const merchantId = req.body?.id;

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

function getCurrentDate() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
}





module.exports = router;


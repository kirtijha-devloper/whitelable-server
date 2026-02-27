const express = require('express');
const router = express.Router();
const branchxService = require('../../services/payments/branchxService');
const asyncHandler = require("express-async-handler");
const Beneficiary = require('../../models/Beneficiary');
const Tpin = require('../../models/Tpin');
const User = require('../../models/User');
const bcrypt = require('bcrypt');
const WalletTransaction = require('../../models/WalletTransaction');
const PayoutTransaction = require('../../models/PayoutTransaction');
const crypto = require('crypto');
const ledgerService = require('../../services/ledgerService');

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
    
    const service_charge = parseFloat(req.body.service_charge);
    if (!service_charge || isNaN(service_charge) || service_charge <= 0) {
      return res.status(400).json({ message: "Invalid service charge" });
    }

    const total_amount = amount + service_charge;
    if (parseFloat(user.wallet) < total_amount) {
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
      amount: total_amount,
      status: "pending",
      reason: `${beneficiary.beneficiary_name} payout: ${purpose}`,
      requested_by: beneficiary.id,
      source: "branchx"
    });

    currentDate = getCurrentDate();
    requestId = crypto.randomUUID()

    const payload = {
      amount,
      mobileNumber: beneficiary.mobile_number,
      merchantId: merchant_id,
      requestId: requestId,
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

    // Save payout transaction with status from response
    const payoutStatus = data.status || 'PENDING';
    const payoutTx = await PayoutTransaction.create({
      merchant_id: merchant_id,
      beneficiary_id: beneficiary_id,
      reference_id: requestId || data.api_ref || wallet_transaction.id.toString(),
      amount: amount,
      status: payoutStatus,
      purpose: purpose || null,
      data: JSON.stringify(data),
      service_charge: service_charge
    });

    // Update wallet balance if status is SUCCESS or PENDING
    if (payoutStatus === 'SUCCESS' || payoutStatus === 'PENDING') {
      // Write ledger entry for payout debit
      // NOTE: createPayoutEntry() calls createLedgerEntry() which syncs user.wallet as its last step.
      await ledgerService.createPayoutEntry({
        userId: merchant_id,
        payoutTransactionId: payoutTx.id,
        amount: total_amount,
        description: `Payout to ${beneficiary.beneficiary_name} (${purpose || 'N/A'}) — ref: ${requestId}`,
        status: payoutStatus === 'SUCCESS' ? 'completed' : 'pending',
        metadata: {
          beneficiary_name: beneficiary.beneficiary_name,
          account_number: beneficiary.account_number,
          ifsc_code: beneficiary.ifsc_code,
          bank_name: beneficiary.bank_name,
          payout_amount: amount,
          service_charge: service_charge,
          reference_id: requestId,
          branchx_status: payoutStatus
        }
      });

      wallet_transaction.status = "completed";
      wallet_transaction.reason = `${beneficiary.beneficiary_name} payout purpose: ${purpose} reference id: ${requestId}`;
      await wallet_transaction.save();
    } else {
      // If failed, keep wallet transaction as pending or mark as failed
      wallet_transaction.status = "failed";
      wallet_transaction.reason = `BranchX payout failed: ${data.message || 'Unknown error'}`;
      await wallet_transaction.save();
    }

    console.log(`branchx data: ${JSON.stringify(data)}`);

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

router.get('/beneficiaries/:merchant_id', asyncHandler(async (req, res) => {
  try {
    const merchantId = req.params.merchant_id;

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

    // Validate bank account before adding beneficiary
    let bankValidationResult;
    try {
      const bankValidationPayload = {
        accountNumber,
        ifscCode,
        mobileNumber,
        bankName,
        requestId: accountNumber,
      };

      bankValidationResult = await branchxService.bankValidation(bankValidationPayload);

      // Check if bank validation failed
      if (bankValidationResult.status === 'FAILED' || !bankValidationResult.status || 
          (bankValidationResult.statuscode && parseInt(bankValidationResult.statuscode) >= 400)) {
        return res.status(400).json({
          success: false,
          message: bankValidationResult.message || 'Bank account validation failed. Please check account number and IFSC code.',
          data: bankValidationResult
        });
      }

      // Optional: Verify beneficiary name matches the validated name (if provided)

    } catch (validationError) {
      console.error('Bank validation error:', validationError);
      return res.status(validationError.status || 500).json({
        success: false,
        message: validationError.message || 'Bank account validation failed. Please check your bank details.',
        error: validationError
      });
    }

    // Prepare data payload
    const data = {
      merchant_id: merchantId,
      mobile_number: mobileNumber,
      bank_name: bankName,
      account_number: accountNumber,
      ifsc_code: ifscCode,
      beneficiary_name: bankValidationResult.name,
      email: emailId,
      status: 'verified' // Set as verified since we validated the bank
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
    const merchantId = req.query.merchantId; 

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

// Get all payout transactions
router.get('/payout-transactions', asyncHandler(async (req, res) => {
  try {
    const { merchant_id, beneficiary_id, status, page = 1, limit = 10 } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    // Apply filters
    if (merchant_id) {
      where.merchant_id = merchant_id;
    }

    if (beneficiary_id) {
      where.beneficiary_id = beneficiary_id;
    }

    if (status) {
      where.status = status;
    }

    // Get total count and paginated results
    const { count, rows: payoutTransactions } = await PayoutTransaction.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    // Optionally include related data (beneficiary and merchant info)
    const formattedTransactions = await Promise.all(
      payoutTransactions.map(async (transaction) => {
        const beneficiary = await Beneficiary.findByPk(transaction.beneficiary_id, {
          attributes: ['id', 'beneficiary_name', 'mobile_number', 'bank_name', 'account_number', 'ifsc_code']
        });

        const merchant = await User.findByPk(transaction.merchant_id, {
          attributes: ['id', 'name', 'email']
        });

        return {
          id: transaction.id,
          merchant_id: transaction.merchant_id,
          merchant: merchant ? {
            id: merchant.id,
            name: merchant.name,
            email: merchant.email
          } : null,
          beneficiary_id: transaction.beneficiary_id,
          beneficiary: beneficiary ? {
            id: beneficiary.id,
            beneficiary_name: beneficiary.beneficiary_name,
            mobile_number: beneficiary.mobile_number,
            bank_name: beneficiary.bank_name,
            account_number: beneficiary.account_number,
            ifsc_code: beneficiary.ifsc_code
          } : null,
          reference_id: transaction.reference_id,
          amount: transaction.amount,
          status: transaction.status,
          purpose: transaction.purpose,
          data: transaction.data,
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt
        };
      })
    );

    res.json({
      success: true,
      message: 'Payout transactions retrieved successfully',
      totalItems: count,
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / parseInt(limit)),
      data: formattedTransactions
    });
  } catch (error) {
    console.error('Get payout transactions error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
}));

// Check payout transaction status
router.post('/payout/status-check', asyncHandler(async (req, res) => {
  try {
    const { payout_transaction_id, requestId } = req.body;

    let referenceId = requestId;

    // If payout_transaction_id is provided, get the reference_id from PayoutTransaction
    if (payout_transaction_id && !requestId) {
      const payoutTransaction = await PayoutTransaction.findByPk(payout_transaction_id);
      
      if (!payoutTransaction) {
        return res.status(404).json({
          success: false,
          message: 'Payout transaction not found'
        });
      }

      referenceId = payoutTransaction.reference_id;
    }

    if (!referenceId) {
      return res.status(400).json({
        success: false,
        message: 'Either payout_transaction_id or requestId is required'
      });
    }

    // Call BranchX status check API
    const data = await branchxService.statusCheck(referenceId);

    // Extract the actual transaction status from nested response
    // Response structure: { data: { data: { status: "FAILED" }, status: "SUCCESS" } }
    const transactionStatus = data?.data?.status || data?.status || 'PENDING';

    // Find PayoutTransaction to update
    let payoutTransaction = null;
    
    if (payout_transaction_id) {
      payoutTransaction = await PayoutTransaction.findByPk(payout_transaction_id);
    } else if (referenceId) {
      // If only requestId is provided, find by reference_id
      payoutTransaction = await PayoutTransaction.findOne({
        where: { reference_id: referenceId },
        order: [['createdAt', 'DESC']]
      });
    }

    // Update PayoutTransaction status if found
    if (payoutTransaction) {
      const previousStatus = payoutTransaction.status;
      const newStatus = transactionStatus;

        // Update status and data if status changed
        if (previousStatus !== newStatus) {
          await payoutTransaction.update({ 
            status: newStatus,
            data: JSON.stringify(data)
          });

          // Handle wallet refund if status changes from SUCCESS/PENDING to FAILED
          if ((previousStatus === 'SUCCESS' || previousStatus === 'PENDING') && newStatus === 'FAILED') {
            const user = await User.findByPk(payoutTransaction.merchant_id);
            if (user) {
              // Refund the amount back to wallet
              user.wallet = parseFloat(user.wallet) + parseFloat(payoutTransaction.amount);
              await user.save();
              
              // Update wallet transaction status
              const walletTransaction = await WalletTransaction.findOne({
                where: {
                  source: 'branchx',
                  reference_id: payoutTransaction.reference_id
                },
                order: [['createdAt', 'DESC']]
              });
              
              if (walletTransaction) {
                walletTransaction.status = 'failed';
                walletTransaction.reason = `BranchX payout failed: ${data?.data?.message || 'Transaction failed'}`;
                await walletTransaction.save();
              }
            }
          }
        } else {
          // Update data field even if status hasn't changed
          await payoutTransaction.update({ 
            data: JSON.stringify(data)
          });
        }
    }

    res.json({
      success: true,
      message: 'Status check completed successfully',
      data: data
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Something went wrong',
      error: error
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


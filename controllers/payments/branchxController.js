const express = require('express');
const router = express.Router();
const branchxService = require('../../services/payments/branchxService');
const instantpayService = require('../../services/payments/instantpayService');
const asyncHandler = require("express-async-handler");
const db = require('../../config/database');
const Beneficiary = require('../../models/Beneficiary');
const Tpin = require('../../models/Tpin');
const User = require('../../models/User');
const bcrypt = require('bcrypt');
const PayoutTransaction = require('../../models/PayoutTransaction');
const Ledger = require('../../models/Ledger');
const payoutReferenceService = require('../../services/payoutReferenceService');
const ledgerService = require('../../services/ledgerService');
const PayoutAuditLog = require('../../models/PayoutAuditLog');
const ServiceFee = require('../../models/ServiceFee');
const PayoutCharge = require('../../models/PayoutCharge');
const { serviceNames } = require('../../constants');
const { Op } = require('sequelize');
const {
  SERVICE_SETTING_KEYS,
  assertServiceEnabledOrRespond,
} = require('../../services/serviceSettingsService');
const { hasPermission, EMPLOYEE_PERMISSIONS } = require('../../utils/permissions');

const payoutLocks = new Map();

function normalizeBranchxStatus(statusRaw) {
  if (!statusRaw) return 'PENDING';
  const status = statusRaw.toString().trim().toUpperCase();
  if (['SUCCESS', 'COMPLETED'].includes(status)) return 'SUCCESS';
  if (['FAILED', 'FAILURE', 'REJECTED', 'CANCELLED', 'REVERSED'].includes(status)) return 'FAILED';
  if (['PENDING', 'PROCESSING', 'IN_PROGRESS'].includes(status)) return 'PENDING';
  return 'PENDING';
}

function getBranchxStatusCategory(statusRaw) {
  if (statusRaw === undefined || statusRaw === null) return 'UNKNOWN';
  const status = statusRaw.toString().trim().toUpperCase();
  if (['SUCCESS', 'COMPLETED'].includes(status)) return 'SUCCESS';
  if (['FAILED', 'FAILURE', 'REJECTED', 'CANCELLED', 'REVERSED'].includes(status)) return 'FAILED';
  if (['PENDING', 'PROCESSING', 'IN_PROGRESS'].includes(status)) return 'PENDING';
  return 'UNKNOWN';
}

function isAdminUser(req) {
  return req.user && req.user.role === 'admin';
}

function isCreatorUser(req, payoutTransaction) {
  return req.user && payoutTransaction && req.user.id === payoutTransaction.merchant_id;
}

function cleanupPayoutLocks() {
  const now = Date.now();
  for (const [key, info] of payoutLocks.entries()) {
    if (info.expiresAt <= now) {
      payoutLocks.delete(key);
    }
  }
}

function isPayoutLocked(lockKey) {
  cleanupPayoutLocks();
  const lock = payoutLocks.get(lockKey);
  return !!lock;
}

function lockPayout(lockKey, durationMs = 180000) {
  payoutLocks.set(lockKey, { expiresAt: Date.now() + durationMs });
}

const BRANCHX_MANUAL_REFUND_EFFECTIVE_DATE = new Date('2026-04-26T00:00:00Z');

async function resolvePayoutServiceCharge(amount) {
  const computeCharge = (row) => {
    if (row.rate_type === 'flat') return parseFloat(row.rate || 0);
    const pct = parseFloat(row.rate || 0);
    return (isNaN(pct) || pct < 0) ? 0 : parseFloat(((amount * pct) / 100).toFixed(2));
  };

  const slab = await PayoutCharge.findOne({
    where: {
      is_active: true,
      from_amount: { [Op.lte]: amount },
      to_amount: { [Op.gte]: amount }
    },
    order: [['from_amount', 'DESC']]
  });

  if (slab) {
    const charge = computeCharge(slab);
    if (charge > 0) return charge;
  }

  // No matching slab (or slab had zero rate) — fall back to the highest active rate
  const maxSlab = await PayoutCharge.findOne({
    where: { is_active: true },
    order: [['rate', 'DESC']]
  });

  if (!maxSlab) {
    throw Object.assign(new Error('Payout service charge is not configured. Please contact support.'), { status: 503 });
  }

  const maxCharge = computeCharge(maxSlab);
  if (maxCharge <= 0) {
    throw Object.assign(new Error('Payout service charge configuration is invalid. Please contact support.'), { status: 503 });
  }

  return maxCharge;
}

function isEligibleForBranchxManualRefund(payoutTransaction) {
  if (!payoutTransaction || !payoutTransaction.createdAt) return false;
  return new Date(payoutTransaction.createdAt) >= BRANCHX_MANUAL_REFUND_EFFECTIVE_DATE;
}

function getStoredBranchxResponse(payoutTransaction) {
  if (!payoutTransaction) return null;

  const parseJson = (value) => {
    if (!value) return null;
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch (err) {
      return null;
    }
  };

  const parsedData = parseJson(payoutTransaction.data);
  if (parsedData && typeof parsedData === 'object') {
    if (parsedData.data || parsedData.status || parsedData.Status || parsedData.statuscode || parsedData.statusCode) {
      return parsedData;
    }
    if (parsedData.callback) {
      return parsedData.callback;
    }
  }

  const callbackData = parseJson(payoutTransaction.callback_data || payoutTransaction.callbackData);
  if (callbackData && typeof callbackData === 'object') {
    return callbackData;
  }

  return null;
}

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

    const tpin = req.body.tpin;

    if (!tpin) {
      res.status(400);
      throw new Error("T-PIN is required");
    }

    if (!['merchant', 'franchaise'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only merchant or franchise can initiate payouts' });
    }

    const user = await User.findByPk(merchant_id);
    if (!user) {
      return res.status(404).json({ message: "Merchant not found" });
    }
    if (!(await assertServiceEnabledOrRespond(res, SERVICE_SETTING_KEYS.BRANCHX_PAYOUT, user))) {
      return;
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

    const amount = parseFloat(req.body.amount);
    
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: "Invalid transfer amount" });
    }

    // service_charge is always resolved from admin payout rules (PayoutCharge table).
    let service_charge = await resolvePayoutServiceCharge(amount);

    if (service_charge === null || service_charge === undefined || isNaN(service_charge)) {
      return res.status(400).json({ message: "Invalid service charge" });
    }

    service_charge = Number(service_charge);
    if (service_charge <= 0) {
      return res.status(400).json({ message: "Invalid service charge" });
    }

    // Allow zero charge if no slab or service charge is intentionally zero

    const total_amount = amount + service_charge;

    // Phase 1: Validate, create DB record, and debit wallet BEFORE calling BranchX.
    // This ensures a record always exists even if the BranchX network call fails or times out.
    let payoutTx;
    let safeBeneficiary;
    let requestId;
    {
      const transaction = await db.transaction();
      try {
        const lockedUser = await User.findByPk(merchant_id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!lockedUser) {
          await transaction.rollback();
          return res.status(404).json({ message: "Merchant not found" });
        }

        const availableBalance = await ledgerService.getAvailableBalance(merchant_id);
        if (availableBalance < total_amount) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Insufficient balance. Available: ₹${availableBalance.toFixed(2)}, Required: ₹${total_amount.toFixed(2)}`
          });
        }

        safeBeneficiary = await Beneficiary.findByPk(beneficiary_id);
        if (!safeBeneficiary) {
          await transaction.rollback();
          return res.status(404).json({ message: "Beneficiary not found" });
        }

        const lockKey = `${merchant_id}:${beneficiary_id}:${amount}`;
        if (isPayoutLocked(lockKey)) {
          await transaction.rollback();
          return res.status(409).json({
            success: false,
            message: 'Duplicate payout detected. Please wait a few minutes before retrying.'
          });
        }

        const recentDuplicate = await PayoutTransaction.findOne({
          where: {
            merchant_id,
            beneficiary_id,
            amount,
            status: {
              [Op.notIn]: ['FAILED']
            },
            createdAt: {
              [Op.gte]: new Date(Date.now() - 3 * 60 * 1000)
            }
          },
          order: [['createdAt', 'DESC']]
        });

        if (recentDuplicate) {
          await transaction.rollback();
          return res.status(409).json({
            success: false,
            message: 'Duplicate payout detected. Please wait a few minutes before retrying.'
          });
        }

        if (safeBeneficiary.status === 'inactive') {
          await transaction.rollback();
          return res.status(400).json({ message: "Beneficiary is disabled" });
        }

        lockPayout(lockKey);

        requestId = req.body.requestId || null;
        if (!requestId) {
          requestId = await payoutReferenceService.getNextPayoutReference({ provider: 'branchx', userId: merchant_id });
        }

        // Create PayoutTransaction as PENDING before calling BranchX
        payoutTx = await PayoutTransaction.create({
          merchant_id,
          beneficiary_id,
          payout_provider: 'BranchX',
          reference_id: requestId,
          amount,
          status: 'PENDING',
          purpose: purpose || null,
          service_charge
        }, { transaction });

        await PayoutAuditLog.create({
          payout_id: payoutTx.id,
          action: 'BRANCHX_PAYOUT_REQUEST',
          details: {
            requestPayload: { amount, requestId, accountNumber: safeBeneficiary.account_number, ifscCode: safeBeneficiary.ifsc_code, beneficiaryName: safeBeneficiary.beneficiary_name },
            reference_id: requestId
          }
        }, { transaction });

        // Debit wallet before calling BranchX
        await ledgerService.createPayoutEntry({
          userId: merchant_id,
          payoutTransactionId: payoutTx.id,
          amount: total_amount,
          description: `Payout to ${safeBeneficiary.beneficiary_name} (${purpose || 'N/A'}) — ref: ${requestId}`,
          metadata: {
            beneficiary_name: safeBeneficiary.beneficiary_name,
            account_number: safeBeneficiary.account_number,
            ifsc_code: safeBeneficiary.ifsc_code,
            bank_name: safeBeneficiary.bank_name,
            payout_amount: amount,
            service_charge,
            reference_id: requestId
          }
        }, { transaction });

        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    }

    // Phase 2: Call BranchX AFTER records are committed.
    // If this call throws or times out, the record and debit already exist.
    // The callback or cron will handle final status resolution.
    const payload = {
      amount,
      mobileNumber: safeBeneficiary.mobile_number,
      requestId,
      accountNumber: safeBeneficiary.account_number,
      ifscCode: safeBeneficiary.ifsc_code,
      beneficiaryName: safeBeneficiary.beneficiary_name,
      remitterName: user.name || '',
      bankName: safeBeneficiary.bank_name,
      transferMode: 'IMPS',
      latitude: latitude || '',
      longitude: longitude || '',
      emailId: safeBeneficiary.email || '',
      purpose: purpose || 'Payout Request'
    };

    let data;
    try {
      data = await branchxService.payout(payload);
    } catch (branchxError) {
      // BranchX call failed — record and debit already saved.
      // Status remains PENDING; refund will only be issued via BranchX callback or cron job.
      await payoutTx.update({ data: JSON.stringify({ error: branchxError?.message || branchxError }) });
      await PayoutAuditLog.create({
        payout_id: payoutTx.id,
        action: 'BRANCHX_PAYOUT_GATEWAY_ERROR',
        details: { error: branchxError?.message || branchxError, reference_id: requestId }
      });
      const isHtml = typeof branchxError === 'string' && branchxError.trim().startsWith('<');
      const message = isHtml ? 'Payout gateway error. Please try again later.' : (branchxError?.message || branchxError?.msg || 'Something went wrong');
      return res.status(502).json({ success: false, message, reference_id: requestId });
    }

    // Phase 3: Update record with BranchX response
    const rawBranchxStatus = data.status || data.Status || null;
    const branchxStatus = rawBranchxStatus ? normalizeBranchxStatus(rawBranchxStatus) : 'NOT_RECEIVED';
    await payoutTx.update({ data: JSON.stringify(data) });
    await PayoutAuditLog.create({
      payout_id: payoutTx.id,
      action: 'BRANCHX_PAYOUT_RESPONSE',
      details: {
        responsePayload: data,
        branchxStatus,
        status: branchxStatus,
        reference_id: requestId
      }
    });

    return res.json({
      success: true,
      message: data.message || 'Payout request processed successfully',
      payout_provider: 'BranchX',
      reference_id: requestId,
      data
    });
  } catch (error) {
    console.error('Payout error:', error);
    const isHtml = typeof error === 'string' && error.trim().startsWith('<');
    const message = isHtml
      ? 'Payout gateway error. Please try again later.'
      : (error.message || error.msg || 'Something went wrong');
    const statusCode = (res.statusCode && res.statusCode !== 200)
      ? res.statusCode
      : (error.status || 500);
    res.status(statusCode).json({ 
      success: false, 
      message
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
      bankIfsc: ifscCode,
      name: bankName || 'Bank Verification',
      externalRef: requestId
    };

    const data = await instantpayService.verifyBankAccount(payload);

    // Check InstantPay response status
    if (data.status === 'FAILED') {
      return res.status(data.statuscode ? parseInt(data.statuscode) : 400).json({
        success: false,
        message: data.message || 'Bank account validation failed',
        data
      });
    }

    // successful validation – apply service fee if configured
    const feeRec = await ServiceFee.findOne({
      where: { service_name: serviceNames.BANK_VERIFICATION, is_active: true }
    });
    if (feeRec) {
      let charge = 0;
      const flat = parseFloat(feeRec.flat_fee || 0);
      const pct = parseFloat(feeRec.percent_fee || 0);
      if (pct > 0) {
        // no amount context – treat percent as flat on 1 unit or ignore
        // for now we ignore percent fees in validation since there is no amount
        charge = flat;
      } else {
        charge = flat;
      }
      if (charge > 0) {
        await ledgerService.createLedgerEntry({
          userId: req.user.id,
          transactionType: 'service_fee',
          description: `Bank validation fee`,
          debit: charge,
          metadata: { service_name: serviceNames.BANK_VERIFICATION }
        });
      }
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
        status: { [Op.in]: ['active', 'verified'] } // Only get active and verified beneficiaries
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
        bankIfsc: ifscCode,
        name: beneficiaryName,
        externalRef: accountNumber
      };

      bankValidationResult = await instantpayService.verifyBankAccount(bankValidationPayload);

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

    let beneficiary = await Beneficiary.findOne({
      where: {
        merchant_id: merchantId,
        account_number: accountNumber,
        ifsc_code: ifscCode
      }
    });

    if (beneficiary) {
      const updates = {};
      updates.beneficiary_name = bankValidationResult.name;
      if (bankName) updates.bank_name = bankName;
      if (mobileNumber) updates.mobile_number = mobileNumber;
      if (emailId) updates.email = emailId;
      updates.status = 'verified';
      await beneficiary.update(updates);
    } else {
      beneficiary = await Beneficiary.create({
        merchant_id: merchantId,
        mobile_number: mobileNumber,
        bank_name: bankName,
        account_number: accountNumber,
        ifsc_code: ifscCode,
        beneficiary_name: bankValidationResult.name,
        email: emailId,
        status: 'verified' // Set as verified since we validated the bank
      });
    }

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
          payout_provider: transaction.payout_provider,
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
    const { reference_id } = req.body;

    if (!reference_id) {
      return res.status(400).json({
        success: false,
        message: 'reference_id is required'
      });
    }

    const payoutTransaction = await PayoutTransaction.findOne({
      where: { reference_id },
      order: [['createdAt', 'DESC']]
    });

    if (!payoutTransaction) {
      return res.status(404).json({
        success: false,
        message: 'Payout transaction not found'
      });
    }

    const isAdmin = isAdminUser(req);
    const isCreator = isCreatorUser(req, payoutTransaction);
    const isEmployeeManager = hasPermission(req.user, EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE);
    if (!isAdmin && !isCreator && !isEmployeeManager) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to check this payout status'
      });
    }

    const data = await branchxService.statusCheck(reference_id);
    const rawStatus = data?.data?.status ?? data?.data?.Status ?? null;
    const statusCode = data?.statuscode ?? data?.statusCode ?? data?.data?.statuscode ?? data?.data?.statusCode ?? null;
    const statusCategory = getBranchxStatusCategory(rawStatus);
    const previousStatus = payoutTransaction.status;
    let action = 'no_action';

    if (statusCategory === 'SUCCESS' || statusCategory === 'PENDING') {
      if (previousStatus !== statusCategory) {
        await payoutTransaction.update({
          status: statusCategory,
          data: JSON.stringify(data)
        });
        action = 'status_updated';
      } else {
        await payoutTransaction.update({
          data: JSON.stringify(data)
        });
        action = 'data_refreshed';
      }

      await PayoutAuditLog.create({
        payout_id: payoutTransaction.id,
        action: 'BRANCHX_STATUS_CHECK',
        details: {
          reference_id: payoutTransaction.reference_id,
          requestedBy: req.user?.id,
          requestedRole: req.user?.role,
          from: previousStatus,
          to: statusCategory,
          responseStatus: statusCategory,
          rawStatus,
          statusCode,
          branchxResponse: data,
          action
        }
      });
    } else if (statusCategory === 'FAILED') {
      await payoutTransaction.update({
        data: JSON.stringify(data)
      });
      action = 'failed_no_update';

      await PayoutAuditLog.create({
        payout_id: payoutTransaction.id,
        action: 'BRANCHX_STATUS_CHECK_FAILED',
        details: {
          reference_id: payoutTransaction.reference_id,
          requestedBy: req.user?.id,
          requestedRole: req.user?.role,
          from: previousStatus,
          to: previousStatus,
          responseStatus: 'FAILED',
          rawStatus,
          statusCode,
          branchxResponse: data,
          reason: 'Failed status checked, no status change or refund is performed'
        }
      });
    } else {
      await payoutTransaction.update({
        data: JSON.stringify(data)
      });
      action = 'unknown_status_no_action';

      await PayoutAuditLog.create({
        payout_id: payoutTransaction.id,
        action: 'BRANCHX_STATUS_CHECK_NO_ACTION',
        details: {
          reference_id: payoutTransaction.reference_id,
          requestedBy: req.user?.id,
          requestedRole: req.user?.role,
          responseStatus: 'UNKNOWN',
          rawStatus,
          statusCode,
          branchxResponse: data,
          reason: 'Explicit BranchX status not found; no status change performed'
        }
      });
    }

    return res.json({
      success: true,
      message: 'Status check completed successfully',
      action,
      payoutTransactionId: payoutTransaction.id,
      status: payoutTransaction.status,
      branchxStatus: statusCategory,
      data
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

router.post('/payout/manual-refund', asyncHandler(async (req, res) => {
  try {
    if (!isAdminUser(req) && !hasPermission(req.user, EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE)) {
      return res.status(403).json({ success: false, message: 'Admin or authorized employee access required' });
    }

    const { reference_id } = req.body;

    if (!reference_id) {
      return res.status(400).json({ success: false, message: 'reference_id is required' });
    }

    const payoutTransaction = await PayoutTransaction.findOne({
      where: { reference_id },
      order: [['createdAt', 'DESC']]
    });

    if (!payoutTransaction) {
      return res.status(404).json({ success: false, message: 'Payout transaction not found' });
    }

    if (!isEligibleForBranchxManualRefund(payoutTransaction)) {
      return res.status(400).json({
        success: false,
        message: `Manual refund is allowed only for payouts created on or after ${BRANCHX_MANUAL_REFUND_EFFECTIVE_DATE.toISOString()}`
      });
    }

    const branchxResponse = getStoredBranchxResponse(payoutTransaction);
    if (!branchxResponse) {
      return res.status(400).json({
        success: false,
        message: 'Manual refund requires a previously fetched BranchX status response. Please use status check first.'
      });
    }

    const rawStatus = branchxResponse?.data?.status ?? branchxResponse?.data?.Status ?? branchxResponse?.status ?? branchxResponse?.Status ?? null;
    const statusCode = branchxResponse?.statuscode ?? branchxResponse?.statusCode ?? branchxResponse?.data?.statuscode ?? branchxResponse?.data?.statusCode ?? null;
    const statusCategory = getBranchxStatusCategory(rawStatus);

    if (statusCategory !== 'FAILED') {
      return res.status(400).json({
        success: false,
        message: 'Stored BranchX status must be FAILED to issue a manual refund',
        branchxStatus: statusCategory,
        statusCode,
        data: branchxResponse
      });
    }

    let refundCreated = false;
    const existingRefund = await Ledger.findOne({
      where: {
        transaction_type: 'payout_refund',
        reference_id: payoutTransaction.id,
        reference_table: 'PayoutTransactions'
      }
    });

    if (!existingRefund) {
      const refundAmount = parseFloat(payoutTransaction.amount || 0) + parseFloat(payoutTransaction.service_charge || 0);
      await ledgerService.createLedgerEntry({
        userId: payoutTransaction.merchant_id,
        transactionType: 'payout_refund',
        referenceId: payoutTransaction.id,
        referenceTable: 'PayoutTransactions',
        description: `Manual refund for failed BranchX payout ${payoutTransaction.reference_id}`,
        credit: refundAmount,
        metadata: {
          payout_reference: payoutTransaction.reference_id,
          performed_by: req.user?.id,
          performed_role: req.user?.role,
          branchx_status_code: statusCode,
          refund_source: 'stored_status'
        }
      });
      refundCreated = true;
    }

    const updatedData = payoutTransaction.data || JSON.stringify(branchxResponse);
    await payoutTransaction.update({
      status: 'FAILED',
      data: updatedData
    });

    await PayoutAuditLog.create({
      payout_id: payoutTransaction.id,
      action: refundCreated ? 'BRANCHX_MANUAL_REFUND' : 'BRANCHX_MANUAL_REFUND_SKIPPED',
      details: {
        reference_id: payoutTransaction.reference_id,
        requestedBy: req.user?.id,
        requestedRole: req.user?.role,
        branchxStatus: 'FAILED',
        rawStatus,
        statusCode,
        refundCreated,
        branchxResponse: branchxResponse
      }
    });

    return res.json({
      success: true,
      message: refundCreated ? 'Manual refund created successfully' : 'Refund already exists; no action taken',
      action: refundCreated ? 'manual_refund_created' : 'manual_refund_skipped_existing',
      refundCreated,
      payoutTransactionId: payoutTransaction.id,
      status: payoutTransaction.status,
      branchxStatus: statusCategory,
      data: branchxResponse
    });
  } catch (error) {
    console.error('Manual refund error:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Something went wrong',
      error
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


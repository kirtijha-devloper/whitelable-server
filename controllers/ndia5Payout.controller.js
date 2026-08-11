/**
 * =========================================================================
 * NDIA5 PAYOUT CONTROLLER
 * =========================================================================
 * Express controller handling NDIA5 API endpoints:
 * - Initiate Payout (With Wallet Debit, T-PIN, & Service Charges)
 * - Check Payout Status
 * - Check Self Balance
 * - Manual Refund Payout (Strictly manual, no auto-refund on failure)
 * - Payout Audit Logs
 * - Beneficiary Management (With 3-step fallback: InstantPay -> BranchX -> Manual)
 */

const asyncHandler = require('express-async-handler');
const ndia5Service = require('../services/ndia5Payout.service');
const PayoutTransaction = require('../models/PayoutTransaction');
const PayoutAuditLog = require('../models/PayoutAuditLog');
const User = require('../models/User');
const Beneficiary = require('../models/Beneficiary');
const PayoutCharge = require('../models/PayoutCharge');
const ServiceFee = require('../models/ServiceFee');
const ledgerService = require('../services/ledgerService');
const payoutReferenceService = require('../services/payoutReferenceService');
const instantpayService = require('../services/payments/instantpayService');
const branchxService = require('../services/payments/branchxService');
const db = require('../config/database');
const { Op } = require('sequelize');
const {
  SERVICE_SETTING_KEYS,
  assertServiceEnabledOrRespond,
} = require('../services/serviceSettingsService');
const { verifyTpinForUser } = require('../services/tpinService');
const { serviceNames } = require('../constants');

/**
 * Safely parse JSON strings
 */
function parseJsonMaybe(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

/**
 * Helpers to resolve context
 */
async function resolveMerchantContext(req, inputMerchantId) {
  const user = req.user;
  const role = String(user?.role || '').toLowerCase();
  
  if (role === 'admin' && inputMerchantId) {
    const target = await User.findByPk(inputMerchantId);
    if (!target) throw Object.assign(new Error('Merchant not found'), { status: 404 });
    return { merchantId: target.id, merchant: target };
  }
  
  return { merchantId: user.id, merchant: user };
}

async function resolveBeneficiaryContext(merchantId, beneficiaryId) {
  const beneficiary = await Beneficiary.findOne({
    where: { id: beneficiaryId, merchant_id: merchantId, status: { [Op.in]: ['active', 'verified'] } }
  });
  if (!beneficiary) throw Object.assign(new Error('Beneficiary not found or inactive'), { status: 404 });
  return beneficiary;
}

async function findBeneficiaryForUser(req, beneficiaryId) {
  const user = req.user;
  const role = String(user?.role || '').toLowerCase();
  
  const where = { id: beneficiaryId };
  if (role !== 'admin') {
    where.merchant_id = user.id;
  }
  
  const beneficiary = await Beneficiary.findOne({ where });
  if (!beneficiary) throw Object.assign(new Error('Beneficiary not found'), { status: 404 });
  return beneficiary;
}

/**
 * Helper to calculate payout service charge
 */
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

/**
 * POST /api/ndia5/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const token = await ndia5Service.login(true);
  return res.status(200).json({
    success: true,
    message: 'NDIA5 login successful',
    token,
  });
});

/**
 * GET/POST /api/ndia5/payout/balance
 */
const getBalance = asyncHandler(async (req, res) => {
  const result = await ndia5Service.getBalance(req.body || {});
  return res.status(200).json({
    success: true,
    message: 'NDIA5 balance fetched successfully',
    data: result,
  });
});

/**
 * GET /api/ndia5/payout/reference
 */
const getPayoutReference = asyncHandler(async (req, res) => {
  const { merchantId } = await resolveMerchantContext(req, req.query.merchant_id || req.body?.merchant_id);
  const reference = await payoutReferenceService.getNextPayoutReference({ provider: 'ndia5', userId: merchantId || req.user?.id });

  res.status(200).json({
    success: true,
    reference,
    crn: reference,
    merchantRefId: reference,
  });
});

/**
 * POST /api/ndia5/beneficiaries
 * Implements the 3-step bank verification fallback flow
 */
const createBeneficiary = asyncHandler(async (req, res) => {
  const { merchantId } = await resolveMerchantContext(req, req.body.merchant_id);
  const {
    beneficiary_name,
    account_number,
    ifsc_code,
    bank_name,
    branch_name,
    mobile_number,
    email,
    forceAdd,
    bypassVerification
  } = req.body;

  if (!merchantId || !beneficiary_name || !account_number || !ifsc_code || !bank_name) {
    return res.status(400).json({
      success: false,
      message: 'merchant_id, beneficiary_name, account_number, ifsc_code, and bank_name are required.',
    });
  }

  const isForced = forceAdd === true || forceAdd === 'true' || bypassVerification === true || bypassVerification === 'true';
  let verifiedName = beneficiary_name;

  if (!isForced) {
    let bankValidationResult = null;
    let validationSuccess = false;

    // Step 1: Try InstantPay BAV
    try {
      bankValidationResult = await instantpayService.verifyBankAccount({
        merchantId: merchantId,
        name: beneficiary_name,
        accountNumber: account_number,
        bankIfsc: ifsc_code
      });
      if (bankValidationResult && bankValidationResult.status === 'SUCCESS') {
        verifiedName = bankValidationResult.name || beneficiary_name;
        validationSuccess = true;
      }
    } catch (ipError) {
      console.error('[ndia5-payout] InstantPay verification failed:', ipError.message || ipError);
    }

    // Step 2: Fallback to BranchX BAV
    if (!validationSuccess) {
      try {
        console.log('[ndia5-payout] Falling back to BranchX for verification...');
        const branchxPayload = {
          merchantId: merchantId,
          accountNumber: account_number,
          bankIfsc: ifsc_code,
          name: beneficiary_name,
          externalRef: `BAV${Date.now()}`
        };
        const branchxResult = await branchxService.bankValidation(branchxPayload);
        if (branchxResult && (branchxResult.status === 'SUCCESS' || branchxResult.statuscode === '200')) {
          verifiedName = branchxResult.name || beneficiary_name;
          validationSuccess = true;
          
          // Apply service fee
          const feeRec = await ServiceFee.findOne({
            where: { service_name: serviceNames.BANK_VERIFICATION, is_active: true }
          });
          if (feeRec) {
            const charge = parseFloat(feeRec.flat_fee || 0);
            if (charge > 0) {
              await ledgerService.createLedgerEntry({
                userId: req.user.id,
                transactionType: 'service_fee',
                description: `Bank validation fee (BranchX fallback)`,
                debit: charge,
                metadata: { service_name: serviceNames.BANK_VERIFICATION }
              });
            }
          }
        }
      } catch (bxError) {
        console.error('[ndia5-payout] BranchX verification fallback failed:', bxError.message || bxError);
      }
    }

    // Step 3: If both failed, return validationFailed status for manual confirmation modal
    if (!validationSuccess) {
      return res.status(400).json({
        success: false,
        verificationFailed: true,
        message: 'Bank account validation failed on both InstantPay and BranchX. Do you want to proceed without verification?',
      });
    }
  }

  // Create or update record
  let beneficiary = await Beneficiary.findOne({
    where: {
      merchant_id: merchantId,
      account_number: account_number,
      ifsc_code: ifsc_code
    }
  });

  const updates = {
    beneficiary_name: verifiedName,
    bank_name,
    branch_name: branch_name || null,
    mobile_number: mobile_number || '',
    email: email || '',
    status: 'active'
  };

  if (beneficiary) {
    await beneficiary.update(updates);
  } else {
    beneficiary = await Beneficiary.create({
      merchant_id: merchantId,
      account_number: account_number,
      ifsc_code: ifsc_code,
      ...updates
    });
  }

  res.status(201).json({
    success: true,
    data: beneficiary,
  });
});

/**
 * GET /api/ndia5/beneficiaries/:merchant_id
 */
const listBeneficiaries = asyncHandler(async (req, res) => {
  const requestedMerchantId = req.query.merchant_id || req.params.merchant_id || req.user?.id || null;
  const { merchantId } = await resolveMerchantContext(req, requestedMerchantId);

  const beneficiaries = await Beneficiary.findAll({
    where: { merchant_id: merchantId, status: { [Op.in]: ['active', 'verified'] } },
    order: [['createdAt', 'DESC']],
  });

  res.status(200).json({
    success: true,
    count: beneficiaries.length,
    data: beneficiaries,
  });
});

/**
 * DELETE /api/ndia5/beneficiaries/:id
 */
const deleteBeneficiary = asyncHandler(async (req, res) => {
  const beneficiary = await findBeneficiaryForUser(req, req.params.id);

  await beneficiary.update({ status: 'inactive' });

  res.status(200).json({
    success: true,
    message: 'Beneficiary deleted successfully',
  });
});

/**
 * POST /api/ndia5/payout
 * Initiate payout via NDIA5 gateway (With TPIN, Wallet debit, & fees)
 */
const initiatePayout = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Valid payout amount is required' });
  }

  const { merchantId, merchant } = await resolveMerchantContext(req, req.body.merchant_id);
  if (!(await assertServiceEnabledOrRespond(res, SERVICE_SETTING_KEYS.NDIA5_PAYOUT, merchant))) {
    return;
  }

  // Pre-check NDIA5 company self balance before processing payout initiation
  let companyBalance = 0;
  let balanceCheckFailed = false;
  try {
    const balanceResult = await ndia5Service.getBalance({});
    companyBalance = Number(balanceResult.balance ?? balanceResult.rawResponse ?? 0);
    if (isNaN(companyBalance)) companyBalance = 0;
  } catch (balanceErr) {
    console.error('[NDIA5 Company Balance Check Error]:', balanceErr.message);
    balanceCheckFailed = true;
  }

  // If company balance is insufficient or balance check failed
  if (balanceCheckFailed || companyBalance < amount) {
    ndia5Service.india5Log('INITIATE_PAYOUT_REJECTED', {
      error: 'insufficient company balance',
      requestedAmount: amount,
      availableCompanyBalance: companyBalance,
      balanceCheckFailed,
    });

    return res.status(400).json({
      success: false,
      message: 'Server downtime, please try after 10 min',
    });
  }

  const tpin = req.body.tpin;
  if (!tpin) {
    return res.status(400).json({
      success: false,
      message: 'T-PIN is required.',
    });
  }

  const verification = await verifyTpinForUser(merchantId, tpin);
  if (verification.reason === 'not_found') {
    return res.status(404).json({
      success: false,
      message: 'T-PIN not found. Please generate one.',
    });
  }

  if (verification.reason === 'expired') {
    return res.status(400).json({
      success: false,
      message: 'T-PIN has expired. Please generate a new one.',
    });
  }

  if (!verification.ok) {
    return res.status(401).json({
      success: false,
      message: 'Invalid T-PIN.',
    });
  }

  const beneficiary = await resolveBeneficiaryContext(merchantId, req.body.beneficiary_id);
  const crn = req.body.reference_id || req.body.merchantRefId || await payoutReferenceService.getNextPayoutReference({ provider: 'ndia5', userId: merchantId || req.user?.id });

  const serviceCharge = await resolvePayoutServiceCharge(amount);
  const totalAmount = +(amount + serviceCharge).toFixed(2);

  let payoutTransaction;
  const transaction = await db.transaction();
  try {
    const lockedUser = await User.findByPk(merchantId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!lockedUser) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Merchant not found.',
      });
    }

    const availableBalance = await ledgerService.getAvailableBalance(merchantId);
    if (availableBalance < totalAmount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: ₹${availableBalance.toFixed(2)}, Required: ₹${totalAmount.toFixed(2)}`,
      });
    }

    const existingRef = await PayoutTransaction.findOne({
      where: { reference_id: crn },
      transaction,
    });
    if (existingRef) {
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        message: 'Duplicate payout reference.',
      });
    }

    const recentDuplicate = await PayoutTransaction.findOne({
      where: {
        merchant_id: merchantId,
        beneficiary_id: beneficiary.id,
        amount,
        status: { [Op.notIn]: ['FAILED', 'CANCELLED', 'REVERSED'] },
        createdAt: { [Op.gte]: new Date(Date.now() - 3 * 60 * 1000) },
      },
      order: [['createdAt', 'DESC']],
      transaction,
    });
    if (recentDuplicate) {
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        message: 'Duplicate payout detected. Please wait a few minutes before retrying.',
      });
    }

    payoutTransaction = await PayoutTransaction.create({
      merchant_id: merchantId,
      beneficiary_id: beneficiary.id,
      reference_id: crn,
      amount: amount.toFixed(2),
      status: 'PENDING',
      purpose: req.body.purpose || 'payout',
      payout_provider: 'Ndia5',
      service_charge: serviceCharge,
      data: JSON.stringify({
        provider: 'Ndia5',
        payeeName: beneficiary.beneficiary_name,
        bankAccount: beneficiary.account_number,
        ifsc: beneficiary.ifsc_code,
        channel: 'IMPS',
        initiatedAt: new Date().toISOString(),
        companyBalanceAtInitiation: companyBalance,
      }),
    }, { transaction });

    await ledgerService.createPayoutEntry({
      userId: merchantId,
      payoutTransactionId: payoutTransaction.id,
      amount: totalAmount,
      description: `Ndia5 payout ${crn}`,
      metadata: {
        payout_provider: 'Ndia5',
        crn,
        beneficiary_id: beneficiary.id,
        beneficiary_name: beneficiary.beneficiary_name,
        account_number: beneficiary.account_number,
        ifsc_code: beneficiary.ifsc_code,
        bank_name: beneficiary.bank_name,
      },
    }, { transaction });

    await transaction.commit();
  } catch (dbError) {
    await transaction.rollback();
    console.error('[NDIA5 DB Payout Setup Error]:', dbError);
    return res.status(500).json({
      success: false,
      message: 'Failed to set up transaction internally.',
    });
  }

  // Log initiation audit entry
  await PayoutAuditLog.create({
    payout_id: payoutTransaction.id,
    action: 'NDIA5_PAYOUT_INITIATED',
    details: {
      merchantReferenceId: crn,
      amount,
      channel: 'IMPS',
      payeeName: beneficiary.beneficiary_name,
      bankAccount: beneficiary.account_number,
      ifsc: beneficiary.ifsc_code,
    },
  });

  try {
    // Call NDIA5 Service to initiate payout
    const providerResult = await ndia5Service.initiatePayout({
      merchantReferenceId: crn,
      amount,
      channel: 'IMPS',
      payeeName: beneficiary.beneficiary_name,
      bankAccount: beneficiary.account_number,
      ifsc: beneficiary.ifsc_code,
      customerMobile: beneficiary.mobile_number || '9876543210',
      customerName: beneficiary.beneficiary_name,
    });

    // Update payout transaction record with provider response
    const existingData = parseJsonMaybe(payoutTransaction.data);
    payoutTransaction.status = providerResult.status;
    payoutTransaction.data = JSON.stringify({
      ...existingData,
      provider: 'Ndia5',
      latest: providerResult.rawResponse,
      transactionId: providerResult.transactionId,
    });

    await payoutTransaction.save();

    return res.status(200).json({
      success: true,
      message: 'NDIA5 Payout initiated successfully',
      data: {
        payoutId: payoutTransaction.id,
        referenceId: crn,
        providerTransactionId: providerResult.transactionId,
        status: providerResult.status,
        serviceCharge: payoutTransaction.service_charge,
        rawResponse: providerResult.rawResponse,
      },
    });
  } catch (error) {
    // Mark payout transaction as FAILED if gateway call throws
    payoutTransaction.status = 'FAILED';
    const existingData = parseJsonMaybe(payoutTransaction.data);
    payoutTransaction.data = JSON.stringify({
      ...existingData,
      initiationError: error.message,
    });
    await payoutTransaction.save();

    await PayoutAuditLog.create({
      payout_id: payoutTransaction.id,
      action: 'NDIA5_PAYOUT_INITIATE_FAILED',
      details: {
        error: error.message,
      },
    });

    return res.status(500).json({
      success: false,
      message: error.message || 'NDIA5 Payout Initiation Failed',
      payoutId: payoutTransaction.id,
      referenceId: crn,
    });
  }
});

/**
 * GET/POST /api/ndia5/payout/status
 */
const getPayoutStatus = asyncHandler(async (req, res) => {
  const referenceId = req.query.referenceId || req.query.reference_id || req.body.referenceId || req.body.reference_id;

  if (!referenceId) {
    return res.status(400).json({ success: false, message: 'referenceId parameter is required' });
  }

  const payoutTransaction = await PayoutTransaction.findOne({
    where: { reference_id: referenceId, payout_provider: 'Ndia5' },
  });

  if (!payoutTransaction) {
    return res.status(404).json({ success: false, message: `NDIA5 transaction not found for referenceId: ${referenceId}` });
  }

  const providerResult = await ndia5Service.getPayoutStatus(referenceId);

  const previousStatus = payoutTransaction.status;
  const newStatus = providerResult.status;

  const existingData = parseJsonMaybe(payoutTransaction.data);
  payoutTransaction.status = newStatus;
  payoutTransaction.data = JSON.stringify({
    ...existingData,
    provider: 'Ndia5',
    latestStatusCheck: providerResult.rawResponse,
    lastCheckedAt: new Date().toISOString(),
  });

  await payoutTransaction.save();

  if (previousStatus !== newStatus) {
    await PayoutAuditLog.create({
      payout_id: payoutTransaction.id,
      action: 'NDIA5_STATUS_CHANGED',
      details: {
        referenceId,
        fromStatus: previousStatus,
        toStatus: newStatus,
        rawResponse: providerResult.rawResponse,
        refundNotice: newStatus === 'FAILED' ? 'Status marked FAILED. Refund requires manual approval.' : undefined,
      },
    });
  }

  return res.status(200).json({
    success: true,
    message: 'NDIA5 Payout Status fetched successfully',
    data: {
      payoutId: payoutTransaction.id,
      referenceId: payoutTransaction.reference_id,
      status: payoutTransaction.status,
      serviceCharge: payoutTransaction.service_charge,
      rawResponse: providerResult.rawResponse,
    },
  });
});

/**
 * POST /api/ndia5/payout/manual-refund
 */
const manualRefundPayout = asyncHandler(async (req, res) => {
  const { payout_id, reference_id } = req.body;

  if (!payout_id && !reference_id) {
    return res.status(400).json({ success: false, message: 'payout_id or reference_id is required for manual refund' });
  }

  const whereClause = { payout_provider: 'Ndia5' };
  if (payout_id) whereClause.id = payout_id;
  if (reference_id) whereClause.reference_id = reference_id;

  const payoutTransaction = await PayoutTransaction.findOne({ where: whereClause });

  if (!payoutTransaction) {
    return res.status(404).json({ success: false, message: 'NDIA5 payout transaction not found' });
  }

  if (payoutTransaction.status !== 'FAILED') {
    return res.status(400).json({
      success: false,
      message: `Manual refund is only allowed for FAILED payouts. Current status: ${payoutTransaction.status}`,
    });
  }

  const existingData = parseJsonMaybe(payoutTransaction.data);

  if (existingData.manualRefundProcessed) {
    return res.status(400).json({
      success: false,
      message: 'Manual refund has already been processed for this payout transaction.',
    });
  }

  const amount = Number(payoutTransaction.amount) || 0;
  const serviceCharge = Number(payoutTransaction.service_charge) || 0;
  const refundAmount = amount + serviceCharge;
  let refundEntry = null;

  try {
    if (typeof ledgerService.createLedgerEntry === 'function') {
      refundEntry = await ledgerService.createLedgerEntry({
        userId: payoutTransaction.merchant_id,
        transactionType: 'payout_refund',
        referenceId: payoutTransaction.id,
        referenceTable: 'PayoutTransactions',
        description: `Manual Refund for NDIA5 Payout ${payoutTransaction.reference_id}`,
        credit: refundAmount,
        metadata: {
          payout_provider: 'Ndia5',
          payout_reference: payoutTransaction.reference_id,
          original_payout_amount: String(amount),
          original_service_charge: String(serviceCharge),
          refund_source: 'admin_manual',
          performed_by: req.user?.id,
          performed_role: req.user?.role,
        },
      });
    }
  } catch (ledgerError) {
    console.error('[NDIA5 Manual Refund Ledger Error]:', ledgerError);
  }

  existingData.manualRefundProcessed = true;
  existingData.manualRefundAt = new Date().toISOString();
  existingData.manualRefundBy = req.user?.id || 'admin';
  existingData.refundLedgerId = refundEntry?.id || null;

  payoutTransaction.data = JSON.stringify(existingData);
  await payoutTransaction.save();

  await PayoutAuditLog.create({
    payout_id: payoutTransaction.id,
    action: 'NDIA5_MANUAL_REFUND_COMPLETED',
    details: {
      reference_id: payoutTransaction.reference_id,
      refundAmount,
      refundBy: req.user ? `${req.user.name || req.user.username || 'Admin'} (${req.user.id})` : 'admin',
      refundLedgerId: refundEntry?.id || null,
    },
  });

  return res.status(200).json({
    success: true,
    message: 'NDIA5 manual refund executed successfully.',
    refundCreated: true,
    refundAmount,
    payoutTransactionId: payoutTransaction.id,
  });
});

/**
 * GET /api/ndia5/payout/audit-logs/by-payout
 */
const getPayoutAuditLogsByPayout = asyncHandler(async (req, res) => {
  const { payout_id, reference_id } = req.query;

  const where = {};
  if (payout_id) {
    where.payout_id = payout_id;
  } else if (reference_id) {
    const txn = await PayoutTransaction.findOne({
      where: { reference_id, payout_provider: 'Ndia5' },
    });
    if (txn) {
      where.payout_id = txn.id;
    } else {
      return res.status(404).json({ success: false, message: 'No NDIA5 transaction found for reference_id' });
    }
  } else {
    return res.status(400).json({ success: false, message: 'payout_id or reference_id is required' });
  }

  const logs = await PayoutAuditLog.findAll({
    where,
    order: [['created_at', 'DESC']],
  });

  return res.status(200).json({
    success: true,
    data: logs,
    totalLogs: logs.length,
  });
});

/**
 * GET/POST /api/ndia5/payout/debug-status
 * Fetches status from NDIA5 without modifying DB (used for debugging/checking true status in UI)
 */
const getDebugPayoutStatus = asyncHandler(async (req, res) => {
  const referenceId = req.query.referenceId || req.query.reference_id || req.body.referenceId || req.body.reference_id;

  if (!referenceId) {
    return res.status(400).json({ success: false, message: 'referenceId parameter is required' });
  }

  try {
    const providerResult = await ndia5Service.getPayoutStatus(referenceId);
    
    return res.status(200).json({
      success: true,
      message: 'NDIA5 Debug Payout Status fetched successfully',
      data: providerResult,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch debug status from NDIA5',
    });
  }
});

module.exports = {
  login,
  getBalance,
  getPayoutReference,
  createBeneficiary,
  listBeneficiaries,
  deleteBeneficiary,
  initiatePayout,
  getPayoutStatus,
  manualRefundPayout,
  getPayoutAuditLogsByPayout,
  getDebugPayoutStatus,
};

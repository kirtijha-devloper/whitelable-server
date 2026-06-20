const asyncHandler = require('express-async-handler');
const Beneficiary = require('../models/Beneficiary');
const Ledger = require('../models/Ledger');
const PayoutCharge = require('../models/PayoutCharge');
const PayoutAuditLog = require('../models/PayoutAuditLog');
const PayoutTransaction = require('../models/PayoutTransaction');
const Tpin = require('../models/Tpin');
const User = require('../models/User');
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');
const db = require('../config/database');
const ledgerService = require('../services/ledgerService');
const payoutReferenceService = require('../services/payoutReferenceService');
const sevenpayService = require('../services/sevenpayPayout.service');
const {
  SERVICE_SETTING_KEYS,
  assertServiceEnabledOrRespond,
} = require('../services/serviceSettingsService');
const { hasPermission, EMPLOYEE_PERMISSIONS, normalizeRole } = require('../utils/permissions');
const instantpayService = require('../services/payments/instantpayService');

const SEVENPAY_TEST_MAX_AMOUNT = 101;
const SEVENPAY_IMMEDIATE_STATUS_RETRIES = Number(process.env.SEVENPAY_IMMEDIATE_STATUS_RETRIES || 2);
const SEVENPAY_IMMEDIATE_STATUS_DELAY_MS = Number(process.env.SEVENPAY_IMMEDIATE_STATUS_DELAY_MS || 1500);

function isPrivilegedUser(user) {
  return normalizeRole(user?.role) === 'admin'
    || hasPermission(user, EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE);
}

function canActForMerchant(req, merchantId) {
  if (!merchantId) return true;
  if (isPrivilegedUser(req.user)) return true;
  return Number(req.user?.id) === Number(merchantId);
}

function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBeneficiaryInput(reqBody = {}) {
  return {
    name: reqBody.name || reqBody.receiverName || reqBody.beneficiary_name || null,
    accountNumber: reqBody.account_number || reqBody.accountNo || null,
    ifscCode: reqBody.ifsc_code || reqBody.ifsc || null,
    bankName: reqBody.bank_name || reqBody.bankName || null,
    branchName: reqBody.branch_name || reqBody.branchName || null,
    bankCode: reqBody.bank_code || reqBody.bankCode || null,
    mobileNumber: reqBody.mobile_number || reqBody.mobileNumber || null,
    email: reqBody.email || null,
    state: reqBody.state || null,
  };
}

function buildProviderSnapshot(existingTransaction, normalizedResponse) {
  const previous = parseJsonMaybe(existingTransaction?.data) || {};
  return {
    ...previous,
    provider: 'Sevenpay',
    latest: normalizedResponse.rawResponse,
    normalized: {
      crn: normalizedResponse.crn,
      paymentId: normalizedResponse.paymentId,
      status: normalizedResponse.status,
      amount: normalizedResponse.amount,
      serviceCharge: normalizedResponse.serviceCharge,
      bankReferenceNo: normalizedResponse.bankReferenceNo,
    },
  };
}

async function resolveMerchantContext(req, explicitMerchantId) {
  const requestedMerchantId = explicitMerchantId || req.user?.id || null;
  if (!requestedMerchantId) {
    return { merchantId: null, merchant: null };
  }

  if (!canActForMerchant(req, requestedMerchantId)) {
    const error = new Error('You are not allowed to act for this merchant.');
    error.statusCode = 403;
    throw error;
  }

  const merchant = await User.findByPk(requestedMerchantId);
  if (!merchant) {
    const error = new Error('Merchant not found.');
    error.statusCode = 404;
    throw error;
  }

  return {
    merchantId: Number(requestedMerchantId),
    merchant,
  };
}

async function resolveBeneficiaryContext(merchantId, beneficiaryId) {
  if (!beneficiaryId) {
    return null;
  }

  const beneficiary = await Beneficiary.findByPk(beneficiaryId);
  if (!beneficiary) {
    const error = new Error('Beneficiary not found.');
    error.statusCode = 404;
    throw error;
  }

  if (merchantId && Number(beneficiary.merchant_id) !== Number(merchantId)) {
    const error = new Error('Beneficiary does not belong to the selected merchant.');
    error.statusCode = 403;
    throw error;
  }

  return beneficiary;
}

function buildInitiateProviderPayload({ req, merchantId, beneficiary, crn, amount }) {
  const payload = {
    crn,
    amount: amount.toFixed(2),
    purpose: req.body.purpose || 'Sevenpay UAT payout',
    clientIP: req.body.clientIP || req.ip || '127.0.0.1',
    paymentMode: req.body.paymentMode || 'IMPS',
    refParam1: req.body.refParam1 || '',
    refParam2: req.body.refParam2 || '',
    refParam3: req.body.refParam3 || '',
  };

  if (merchantId) {
    payload.merchantId = merchantId;
  }

  if (req.body.orgId) {
    payload.orgId = req.body.orgId;
  }

  if (req.body.userId) {
    payload.userId = req.body.userId;
  }

  if (beneficiary) {
    payload.beneficiaryId = beneficiary.id;
    payload.receiverName = req.body.receiverName || req.body.beneficiary_name || beneficiary.beneficiary_name;
    payload.ifsc = req.body.ifsc || req.body.ifsc_code || beneficiary.ifsc_code;
    payload.accountNo = req.body.accountNo || req.body.account_number || beneficiary.account_number;
    payload.mobileNumber = req.body.mobileNumber || req.body.mobile_number || beneficiary.mobile_number;
    payload.bankName = req.body.bankName || req.body.bank_name || beneficiary.bank_name;
  } else {
    payload.receiverName = req.body.receiverName || req.body.beneficiary_name;
    payload.ifsc = req.body.ifsc || req.body.ifsc_code;
    payload.accountNo = req.body.accountNo || req.body.account_number;
    payload.mobileNumber = req.body.mobileNumber || req.body.mobile_number;
    payload.bankName = req.body.bankName || req.body.bank_name;
  }

  if (!payload.receiverName || !payload.ifsc || !payload.accountNo) {
    const error = new Error('Either beneficiary_id or direct receiverName, ifsc, and accountNo is required.');
    error.statusCode = 400;
    throw error;
  }

  return payload;
}

async function resolvePayoutServiceCharge(amount) {
  const rule = await PayoutCharge.findOne({
    where: {
      is_active: true,
      from_amount: { [Op.lte]: amount },
      to_amount: { [Op.gte]: amount },
    },
    order: [['from_amount', 'DESC']],
  });

  if (!rule) {
    return 0;
  }

  if (rule.rate_type === 'flat') {
    return +parseFloat(rule.rate || 0).toFixed(2);
  }

  return +parseFloat((amount * parseFloat(rule.rate || 0)) / 100).toFixed(2);
}

async function findBeneficiaryForUser(req, beneficiaryId) {
  const beneficiary = await Beneficiary.findByPk(beneficiaryId);
  if (!beneficiary) {
    const error = new Error('Beneficiary not found.');
    error.statusCode = 404;
    throw error;
  }

  if (!canActForMerchant(req, beneficiary.merchant_id)) {
    const error = new Error('You are not allowed to access this beneficiary.');
    error.statusCode = 403;
    throw error;
  }

  return beneficiary;
}

async function refreshSevenpayTransactionStatus({
  payoutTransaction,
  merchantId,
  beneficiaryId,
  purpose,
  serviceCharge,
  crn,
  paymentId,
}) {
  const serviceResponse = await sevenpayService.getPayoutStatus({
    crn: crn || payoutTransaction?.reference_id || null,
    paymentId: paymentId || null,
  });

  const updatedTransaction = payoutTransaction
    ? await upsertPayoutTransaction({
      existingTransaction: payoutTransaction,
      merchantId,
      beneficiaryId,
      normalizedResponse: serviceResponse,
      purpose,
      serviceChargeOverride: serviceCharge,
    })
    : null;

  return {
    serviceResponse,
    updatedTransaction,
  };
}

async function upsertPayoutTransaction({
  existingTransaction,
  merchantId,
  beneficiaryId,
  normalizedResponse,
  purpose,
  serviceChargeOverride,
}) {
  if (!merchantId) {
    return null;
  }

  const resolvedServiceCharge = serviceChargeOverride !== undefined
    ? serviceChargeOverride
    : (existingTransaction?.service_charge ?? normalizedResponse.serviceCharge);

  const payload = {
    merchant_id: merchantId,
    beneficiary_id: beneficiaryId || null,
    reference_id: normalizedResponse.crn,
    amount: normalizedResponse.amount || '0.00',
    status: normalizedResponse.status,
    purpose: purpose || null,
    data: JSON.stringify(buildProviderSnapshot(existingTransaction, normalizedResponse)),
    service_charge: resolvedServiceCharge,
    payout_provider: 'Sevenpay',
  };

  if (existingTransaction) {
    if (existingTransaction.status === 'SUCCESS' && payload.status !== 'SUCCESS') {
      payload.status = 'SUCCESS';
    }
    
    await existingTransaction.update(payload);

    try {
      await PayoutAuditLog.create({
        payout_id: existingTransaction.id,
        action: 'SEVENPAY_STATUS_UPDATE',
        details: {
          reference_id: payload.reference_id,
          status: payload.status,
          rawResponse: normalizedResponse.rawResponse || null
        }
      });
    } catch (e) {
      console.error('Failed to create PayoutAuditLog:', e);
    }

    return existingTransaction;
  }

  const newTxn = await PayoutTransaction.create(payload);

  try {
    await PayoutAuditLog.create({
      payout_id: newTxn.id,
      action: 'SEVENPAY_PAYOUT_INITIATE',
      details: {
        reference_id: payload.reference_id,
        status: payload.status,
        rawResponse: normalizedResponse.rawResponse || null
      }
    });
  } catch (e) {
    console.error('Failed to create PayoutAuditLog:', e);
  }

  return newTxn;
}

const login = asyncHandler(async (req, res) => {
  const result = await sevenpayService.login({
    forceRefresh: req.body?.forceRefresh === true || req.query?.forceRefresh === 'true',
  });

  res.json({
    success: true,
    message: 'Sevenpay login successful',
    data: {
      cached: result.cached,
      expiresAt: result.expiresAt,
      rawResponse: result.rawResponse,
    },
  });
});

const getPayoutReference = asyncHandler(async (req, res) => {
  const { merchantId } = await resolveMerchantContext(req, req.query.merchant_id || req.body?.merchant_id);
  const reference = await payoutReferenceService.getNextPayoutReference({ provider: 'sevenpay', userId: merchantId || req.user?.id });

  res.status(200).json({
    success: true,
    reference,
    crn: reference,
    merchantRefId: reference,
  });
});

const createBeneficiary = asyncHandler(async (req, res) => {
  const { merchantId } = await resolveMerchantContext(req, req.body.merchant_id);
  const input = normalizeBeneficiaryInput(req.body);

  if (!merchantId || !input.name || !input.accountNumber || !input.ifscCode || !input.bankName) {
    return res.status(400).json({
      success: false,
      message: 'merchant_id, beneficiary name, account number, IFSC code, and bank name are required.',
    });
  }

  try {
    const bankValidationResult = await instantpayService.verifyBankAccount({
      merchantId: merchantId,
      name: input.name,
      accountNumber: input.accountNumber,
      bankIfsc: input.ifscCode
    });

    if (bankValidationResult.status === 'FAILED') {
      return res.status(400).json({
        success: false,
        message: bankValidationResult.message || 'Bank account validation failed. Please check account number and IFSC code.',
        data: bankValidationResult
      });
    }

    const verifiedName = bankValidationResult.name || input.name;

    let beneficiary = await Beneficiary.findOne({
      where: {
        merchant_id: merchantId,
        account_number: input.accountNumber,
        ifsc_code: input.ifscCode
      }
    });

    if (beneficiary) {
      const updates = {};
      updates.beneficiary_name = verifiedName;
      if (input.bankName) updates.bank_name = input.bankName;
      if (input.bankCode) updates.bank_code = input.bankCode;
      if (input.branchName) updates.branch_name = input.branchName;
      if (input.state) updates.state = input.state;
      if (input.mobileNumber) updates.mobile_number = input.mobileNumber;
      if (input.email) updates.email = input.email;
      updates.status = 'active';

      await beneficiary.update(updates);
    } else {
      beneficiary = await Beneficiary.create({
        merchant_id: merchantId,
        beneficiary_name: verifiedName,
        account_number: input.accountNumber,
        ifsc_code: input.ifscCode,
        bank_name: input.bankName,
        branch_name: input.branchName || null,
        bank_code: input.bankCode || null,
        state: input.state || null,
        mobile_number: input.mobileNumber || '',
        email: input.email || '',
        status: 'active',
      });
    }

    res.status(201).json({
      success: true,
      data: beneficiary,
    });
  } catch (error) {
    console.error('Sevenpay add beneficiary validation error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Bank account validation failed. Please check your bank details.',
      error
    });
  }
});

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

const updateBeneficiary = asyncHandler(async (req, res) => {
  const beneficiary = await findBeneficiaryForUser(req, req.params.id);
  const input = normalizeBeneficiaryInput(req.body);

  const updates = {
    beneficiary_name: input.name ?? beneficiary.beneficiary_name,
    account_number: input.accountNumber ?? beneficiary.account_number,
    ifsc_code: input.ifscCode ?? beneficiary.ifsc_code,
    bank_name: input.bankName ?? beneficiary.bank_name,
    branch_name: input.branchName ?? beneficiary.branch_name,
    bank_code: input.bankCode ?? beneficiary.bank_code,
    state: Object.prototype.hasOwnProperty.call(req.body, 'state') ? input.state : beneficiary.state,
    mobile_number: input.mobileNumber ?? beneficiary.mobile_number,
    email: input.email ?? beneficiary.email,
  };

  if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
    updates.status = req.body.status;
  }

  await beneficiary.update(updates);

  res.status(200).json({
    success: true,
    data: beneficiary,
  });
});

const deleteBeneficiary = asyncHandler(async (req, res) => {
  const beneficiary = await findBeneficiaryForUser(req, req.params.id);

  await beneficiary.update({ status: 'inactive' });

  res.status(200).json({
    success: true,
    message: 'Beneficiary deleted successfully',
  });
});

const initiatePayout = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payout amount.',
    });
  }

  if (amount > SEVENPAY_TEST_MAX_AMOUNT) {
    return res.status(400).json({
      success: false,
      message: `SevenPay testing is restricted to payout amounts up to ₹${SEVENPAY_TEST_MAX_AMOUNT}.`,
    });
  }

  const { merchantId, merchant } = await resolveMerchantContext(req, req.body.merchant_id);
  if (!(await assertServiceEnabledOrRespond(res, SERVICE_SETTING_KEYS.SEVENPAY_PAYOUT, merchant))) {
    return;
  }

  const tpin = req.body.tpin;
  if (!tpin) {
    return res.status(400).json({
      success: false,
      message: 'T-PIN is required.',
    });
  }

  const savedTpin = await Tpin.findOne({ where: { user_id: merchantId } });
  if (!savedTpin) {
    return res.status(404).json({
      success: false,
      message: 'T-PIN not found. Please generate one.',
    });
  }

  if (new Date(savedTpin.expires_at) < new Date()) {
    return res.status(400).json({
      success: false,
      message: 'T-PIN has expired. Please generate a new one.',
    });
  }

  const isMatch = await bcrypt.compare(String(tpin), savedTpin.tpin);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: 'Invalid T-PIN.',
    });
  }

  const beneficiary = await resolveBeneficiaryContext(merchantId, req.body.beneficiary_id);
  const crn = req.body.crn || req.body.reference_id || req.body.merchantRefId || await payoutReferenceService.getNextPayoutReference({ provider: 'sevenpay', userId: merchantId || req.user?.id });
  const providerPayload = buildInitiateProviderPayload({
    req,
    merchantId,
    beneficiary,
    crn,
    amount,
  });

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
        beneficiary_id: beneficiary?.id || req.body.beneficiary_id || null,
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
      beneficiary_id: beneficiary?.id || req.body.beneficiary_id || null,
      reference_id: crn,
      amount: amount.toFixed(2),
      status: 'PENDING',
      purpose: providerPayload.purpose,
      data: JSON.stringify({
        provider: 'Sevenpay',
        requestPayload: providerPayload,
      }),
      service_charge: serviceCharge,
      payout_provider: 'Sevenpay',
    }, { transaction });

    await ledgerService.createPayoutEntry({
      userId: merchantId,
      payoutTransactionId: payoutTransaction.id,
      amount: totalAmount,
      description: `Sevenpay payout ${crn}`,
      metadata: {
        payout_provider: 'Sevenpay',
        crn,
        beneficiary_id: beneficiary?.id || req.body.beneficiary_id || null,
        beneficiary_name: providerPayload.receiverName,
        account_number: providerPayload.accountNo,
        ifsc_code: providerPayload.ifsc,
        bank_name: providerPayload.bankName,
        paymentMode: providerPayload.paymentMode,
        service_charge: serviceCharge,
        payout_amount: amount,
      },
    }, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  const serviceResponse = await sevenpayService.initiatePayout(providerPayload);
  let updatedTransaction = await upsertPayoutTransaction({
    existingTransaction: payoutTransaction,
    merchantId,
    beneficiaryId: beneficiary?.id || req.body.beneficiary_id || null,
    normalizedResponse: serviceResponse,
    purpose: providerPayload.purpose,
    serviceChargeOverride: serviceCharge,
  });

  let finalResponse = serviceResponse;

  if (serviceResponse.status === 'PENDING' && (serviceResponse.crn || serviceResponse.paymentId)) {
    for (let attempt = 0; attempt < SEVENPAY_IMMEDIATE_STATUS_RETRIES; attempt += 1) {
      await sleep(SEVENPAY_IMMEDIATE_STATUS_DELAY_MS);

      const refreshed = await refreshSevenpayTransactionStatus({
        payoutTransaction: updatedTransaction || payoutTransaction,
        merchantId,
        beneficiaryId: beneficiary?.id || req.body.beneficiary_id || null,
        purpose: providerPayload.purpose,
        serviceCharge,
        crn: serviceResponse.crn || crn,
        paymentId: serviceResponse.paymentId || null,
      });

      finalResponse = refreshed.serviceResponse;
      updatedTransaction = refreshed.updatedTransaction || updatedTransaction;

      if (finalResponse.status !== 'PENDING') {
        break;
      }
    }
  }

  res.json({
    success: true,
    message: 'Sevenpay payout request submitted',
    data: {
      crn: finalResponse.crn || serviceResponse.crn || crn,
      paymentId: finalResponse.paymentId || serviceResponse.paymentId,
      status: finalResponse.status,
      amount: finalResponse.amount || serviceResponse.amount || amount.toFixed(2),
      serviceCharge,
      bankReferenceNo: finalResponse.bankReferenceNo || serviceResponse.bankReferenceNo,
      rawResponse: finalResponse.rawResponse,
      payoutTransactionId: updatedTransaction?.id || payoutTransaction?.id || null,
    },
  });
});

const getPayoutStatus = asyncHandler(async (req, res) => {
  const payoutTransactionId = req.query.payout_transaction_id || req.body?.payout_transaction_id;
  let payoutTransaction = null;

  if (payoutTransactionId) {
    payoutTransaction = await PayoutTransaction.findByPk(payoutTransactionId);
    if (!payoutTransaction) {
      return res.status(404).json({
        success: false,
        message: 'Payout transaction not found.',
      });
    }

    if (!canActForMerchant(req, payoutTransaction.merchant_id)) {
      return res.status(403).json({
        success: false,
        message: 'You are not allowed to check this payout.',
      });
    }
  }

  const fallbackSnapshot = parseJsonMaybe(payoutTransaction?.data);
  const queryPayload = {
    crn: req.query.crn || req.body?.crn || req.query.reference_id || req.body?.reference_id || req.query.merchantRefId || req.body?.merchantRefId || payoutTransaction?.reference_id || fallbackSnapshot?.normalized?.crn || null,
    paymentId: req.query.paymentId || req.body?.paymentId || fallbackSnapshot?.normalized?.paymentId || null,
  };

  if (!queryPayload.crn && !queryPayload.paymentId) {
    return res.status(400).json({
      success: false,
      message: 'Provide crn, paymentId, or payout_transaction_id.',
    });
  }

  const initialServiceResponse = await sevenpayService.getPayoutStatus(queryPayload);

  if (!payoutTransaction && (initialServiceResponse.crn || initialServiceResponse.paymentId)) {
    payoutTransaction = await PayoutTransaction.findOne({
      where: initialServiceResponse.crn
        ? { reference_id: initialServiceResponse.crn }
        : { id: null },
    });
  }

  const updatedTransaction = payoutTransaction
    ? await upsertPayoutTransaction({
      existingTransaction: payoutTransaction,
      merchantId: payoutTransaction.merchant_id,
      beneficiaryId: payoutTransaction.beneficiary_id,
      normalizedResponse: initialServiceResponse,
      purpose: payoutTransaction.purpose,
      serviceChargeOverride: payoutTransaction.service_charge,
    })
    : null;

  const serviceResponse = initialServiceResponse;

  res.json({
    success: true,
    message: 'Sevenpay payout status fetched successfully',
    data: {
      crn: serviceResponse.crn || queryPayload.crn || null,
      paymentId: serviceResponse.paymentId || queryPayload.paymentId || null,
      status: serviceResponse.status,
      amount: serviceResponse.amount,
      serviceCharge: updatedTransaction?.service_charge ?? payoutTransaction?.service_charge ?? serviceResponse.serviceCharge,
      bankReferenceNo: serviceResponse.bankReferenceNo,
      rawResponse: serviceResponse.rawResponse,
      payoutTransactionId: updatedTransaction?.id || payoutTransaction?.id || null,
    },
  });
});

function normalizeIdArray(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list
    .map((item) => Number(String(item).trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function normalizeStringArray(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list
    .map((item) => String(item).trim())
    .filter(Boolean);
}

const processPendingPayouts = asyncHandler(async (req, res) => {
  const payoutIds = normalizeIdArray(req.body.payout_ids || req.query.payout_ids);
  const referenceIds = normalizeStringArray(req.body.reference_ids || req.query.reference_ids);
  const requestedMerchantId = req.body.merchant_id || req.query.merchant_id || null;
  const limit = Math.min(Math.max(Number(req.body.limit || req.query.limit || 25), 1), 100);

  const where = {
    payout_provider: 'Sevenpay',
    status: 'PENDING',
  };

  if (requestedMerchantId) {
    const { merchantId } = await resolveMerchantContext(req, requestedMerchantId);
    where.merchant_id = merchantId;
  } else if (!isPrivilegedUser(req.user)) {
    where.merchant_id = req.user?.id || 0;
  }

  if (payoutIds.length) {
    where.id = { [Op.in]: payoutIds };
  }

  if (referenceIds.length) {
    where.reference_id = { [Op.in]: referenceIds };
  }

  const pendingTransactions = await PayoutTransaction.findAll({
    where,
    order: [['updatedAt', 'ASC'], ['createdAt', 'ASC']],
    limit,
  });

  const results = [];

  for (const payoutTransaction of pendingTransactions) {
    const snapshot = parseJsonMaybe(payoutTransaction.data) || {};
    const storedPaymentId = snapshot?.normalized?.paymentId || snapshot?.latest?.paymentId || null;
    const beforeStatus = payoutTransaction.status;

    try {
      const refreshed = await refreshSevenpayTransactionStatus({
        payoutTransaction,
        merchantId: payoutTransaction.merchant_id,
        beneficiaryId: payoutTransaction.beneficiary_id,
        purpose: payoutTransaction.purpose,
        serviceCharge: payoutTransaction.service_charge,
        crn: payoutTransaction.reference_id || snapshot?.normalized?.crn || null,
        paymentId: storedPaymentId,
      });

      results.push({
        id: payoutTransaction.id,
        reference_id: payoutTransaction.reference_id,
        beforeStatus,
        afterStatus: refreshed.serviceResponse.status,
        paymentId: refreshed.serviceResponse.paymentId || storedPaymentId,
        bankReferenceNo: refreshed.serviceResponse.bankReferenceNo || null,
        amount: refreshed.serviceResponse.amount || payoutTransaction.amount,
        error: null,
      });
    } catch (error) {
      results.push({
        id: payoutTransaction.id,
        reference_id: payoutTransaction.reference_id,
        beforeStatus,
        afterStatus: beforeStatus,
        paymentId: storedPaymentId,
        bankReferenceNo: null,
        amount: payoutTransaction.amount,
        error: error.message || 'Status refresh failed.',
      });
    }
  }

  const summary = {
    scanned: pendingTransactions.length,
    success: results.filter((item) => item.afterStatus === 'SUCCESS').length,
    failed: results.filter((item) => item.afterStatus === 'FAILED').length,
    pending: results.filter((item) => item.afterStatus === 'PENDING').length,
    errors: results.filter((item) => item.error).length,
  };

  res.status(200).json({
    success: true,
    message: pendingTransactions.length
      ? 'Sevenpay pending payouts processed.'
      : 'No pending Sevenpay payouts found for the selected filters.',
    summary,
    data: results,
  });
});

const manualRefundPayout = asyncHandler(async (req, res) => {
  if (!(normalizeRole(req.user?.role) === 'admin' || hasPermission(req.user, EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE))) {
    return res.status(403).json({
      success: false,
      message: 'Admin or authorized employee access required',
    });
  }

  const referenceId = req.body.reference_id || req.body.crn || req.body.merchantRefId || null;
  const payoutTransactionId = Number(req.body.payout_transaction_id || 0);

  let payoutTransaction = null;
  if (payoutTransactionId > 0) {
    payoutTransaction = await PayoutTransaction.findByPk(payoutTransactionId);
  } else if (referenceId) {
    payoutTransaction = await PayoutTransaction.findOne({
      where: { reference_id: referenceId, payout_provider: 'Sevenpay' },
      order: [['createdAt', 'DESC']],
    });
  }

  if (!payoutTransaction) {
    return res.status(404).json({
      success: false,
      message: 'SevenPay payout transaction not found.',
    });
  }

  if (payoutTransaction.payout_provider !== 'Sevenpay') {
    return res.status(400).json({
      success: false,
      message: 'Manual refund is only supported for SevenPay payouts on this endpoint.',
    });
  }

  if (String(payoutTransaction.status || '').toUpperCase() !== 'FAILED') {
    return res.status(400).json({
      success: false,
      message: 'Manual refund is allowed only when the payout status is FAILED.',
      status: payoutTransaction.status,
    });
  }

  const existingRefund = await Ledger.findOne({
    where: {
      transaction_type: 'payout_refund',
      reference_id: payoutTransaction.id,
      reference_table: 'PayoutTransactions',
    },
  });

  if (existingRefund) {
    await PayoutAuditLog.create({
      payout_id: payoutTransaction.id,
      action: 'SEVENPAY_MANUAL_REFUND_SKIPPED',
      details: {
        reference_id: payoutTransaction.reference_id,
        requestedBy: req.user?.id,
        requestedRole: req.user?.role,
        reason: 'refund_already_exists',
        existingRefundLedgerId: existingRefund.id,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Refund already exists; no action taken.',
      refundCreated: false,
      existingRefundLedgerId: existingRefund.id,
      payoutTransactionId: payoutTransaction.id,
    });
  }

  const refundAmount = parseFloat(payoutTransaction.amount || 0) + parseFloat(payoutTransaction.service_charge || 0);
  const refundEntry = await ledgerService.createLedgerEntry({
    userId: payoutTransaction.merchant_id,
    transactionType: 'payout_refund',
    referenceId: payoutTransaction.id,
    referenceTable: 'PayoutTransactions',
    description: `Manual refund for failed SevenPay payout ${payoutTransaction.reference_id}`,
    credit: refundAmount,
    metadata: {
      payout_provider: 'Sevenpay',
      payout_reference: payoutTransaction.reference_id,
      original_payout_amount: payoutTransaction.amount,
      original_service_charge: payoutTransaction.service_charge,
      refund_source: 'admin_manual',
      performed_by: req.user?.id,
      performed_role: req.user?.role,
    },
  });

  const snapshot = parseJsonMaybe(payoutTransaction.data) || {};
  snapshot.manualRefund = {
    refundedAt: new Date().toISOString(),
    refundedBy: req.user?.id || null,
    refundedRole: req.user?.role || null,
    refundLedgerId: refundEntry?.id || null,
    refundAmount,
  };
  await payoutTransaction.update({ data: JSON.stringify(snapshot) });

  await PayoutAuditLog.create({
    payout_id: payoutTransaction.id,
    action: 'SEVENPAY_MANUAL_REFUND',
    details: {
      reference_id: payoutTransaction.reference_id,
      requestedBy: req.user?.id,
      requestedRole: req.user?.role,
      refundLedgerId: refundEntry?.id || null,
      refundAmount,
      payoutStatus: payoutTransaction.status,
    },
  });

  return res.status(200).json({
    success: true,
    message: 'SevenPay manual refund created successfully.',
    refundCreated: true,
    refundLedgerId: refundEntry?.id || null,
    refundAmount,
    payoutTransactionId: payoutTransaction.id,
  });
});

const getPayoutAuditLogsByPayout = asyncHandler(async (req, res) => {
  const { payout_id, requestId, reference_id } = req.query;

  const where = {};
  if (payout_id) {
    where.payout_id = payout_id;
  } else if (requestId || reference_id) {
    const txn = await PayoutTransaction.findOne({
      where: { reference_id: requestId || reference_id, payout_provider: 'Sevenpay' }
    });
    if (txn) {
      where.payout_id = txn.id;
    } else {
      return res.status(404).json({ success: false, message: 'No audit logs found for this payout.' });
    }
  } else {
    return res.status(400).json({ success: false, message: 'payout_id or reference_id is required' });
  }

  let logs = await PayoutAuditLog.findAll({
    where,
    order: [['created_at', 'DESC']],
  });

  if (!logs || logs.length === 0) {
    let txn = null;
    if (payout_id) {
      txn = await PayoutTransaction.findOne({ where: { id: payout_id, payout_provider: 'Sevenpay' } });
    } else if (requestId || reference_id) {
      txn = await PayoutTransaction.findOne({ where: { reference_id: requestId || reference_id, payout_provider: 'Sevenpay' } });
    }

    if (txn) {
      const parsedData = parseJsonMaybe(txn.data) || {};
      const virtualLogs = [];

      virtualLogs.push({
        id: `virtual-init-${txn.id}`,
        payout_id: txn.id,
        action: 'SEVENPAY_PAYOUT_INITIATE_FALLBACK',
        details: {
          reference_id: txn.reference_id,
          amount: txn.amount,
          status: 'PENDING',
          requestPayload: parsedData.requestPayload || null,
        },
        created_at: txn.createdAt || txn.created_at || new Date().toISOString(),
      });

      if (txn.status !== 'PENDING') {
        virtualLogs.push({
          id: `virtual-update-${txn.id}`,
          payout_id: txn.id,
          action: 'SEVENPAY_STATUS_UPDATE_FALLBACK',
          details: {
            reference_id: txn.reference_id,
            status: txn.status,
            rawResponse: parsedData.latest || parsedData.normalized || null,
            manualRefund: parsedData.manualRefund || null
          },
          created_at: txn.updatedAt || txn.updated_at || new Date().toISOString(),
        });
      }

      virtualLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      return res.status(200).json({
        success: true,
        data: virtualLogs,
        totalLogs: virtualLogs.length,
      });
    }

    return res.status(404).json({ success: false, message: 'No audit logs found for this payout.' });
  }

  res.status(200).json({
    success: true,
    data: logs,
    totalLogs: logs.length,
  });
});

module.exports = {
  login,
  getPayoutReference,
  createBeneficiary,
  listBeneficiaries,
  updateBeneficiary,
  deleteBeneficiary,
  initiatePayout,
  getPayoutStatus,
  processPendingPayouts,
  manualRefundPayout,
  getPayoutAuditLogsByPayout,
};

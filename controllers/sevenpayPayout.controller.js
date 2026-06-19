const asyncHandler = require('express-async-handler');
const Beneficiary = require('../models/Beneficiary');
const PayoutTransaction = require('../models/PayoutTransaction');
const User = require('../models/User');
const { Op } = require('sequelize');
const payoutReferenceService = require('../services/payoutReferenceService');
const sevenpayService = require('../services/sevenpayPayout.service');
const {
  SERVICE_SETTING_KEYS,
  assertServiceEnabledOrRespond,
} = require('../services/serviceSettingsService');
const { hasPermission, EMPLOYEE_PERMISSIONS, normalizeRole } = require('../utils/permissions');
const instantpayService = require('../services/payments/instantpayService');

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

async function upsertPayoutTransaction({
  existingTransaction,
  merchantId,
  beneficiaryId,
  normalizedResponse,
  purpose,
}) {
  if (!merchantId) {
    return null;
  }

  const payload = {
    merchant_id: merchantId,
    beneficiary_id: beneficiaryId || null,
    reference_id: normalizedResponse.crn,
    amount: normalizedResponse.amount || '0.00',
    status: normalizedResponse.status,
    purpose: purpose || null,
    data: JSON.stringify(buildProviderSnapshot(existingTransaction, normalizedResponse)),
    service_charge: normalizedResponse.serviceCharge,
    payout_provider: 'Sevenpay',
  };

  if (existingTransaction) {
    await existingTransaction.update(payload);
    return existingTransaction;
  }

  return PayoutTransaction.create(payload);
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

    const beneficiary = await Beneficiary.create({
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

  const { merchantId, merchant } = await resolveMerchantContext(req, req.body.merchant_id);
  if (!(await assertServiceEnabledOrRespond(res, SERVICE_SETTING_KEYS.SEVENPAY_PAYOUT, merchant))) {
    return;
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

  const serviceResponse = await sevenpayService.initiatePayout(providerPayload);
  const payoutTransaction = await upsertPayoutTransaction({
    existingTransaction: null,
    merchantId,
    beneficiaryId: beneficiary?.id || req.body.beneficiary_id || null,
    normalizedResponse: serviceResponse,
    purpose: providerPayload.purpose,
  });

  res.json({
    success: true,
    message: 'Sevenpay payout request submitted',
    data: {
      crn: serviceResponse.crn || crn,
      paymentId: serviceResponse.paymentId,
      status: serviceResponse.status,
      amount: serviceResponse.amount || amount.toFixed(2),
      serviceCharge: serviceResponse.serviceCharge,
      bankReferenceNo: serviceResponse.bankReferenceNo,
      rawResponse: serviceResponse.rawResponse,
      payoutTransactionId: payoutTransaction?.id || null,
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

  const serviceResponse = await sevenpayService.getPayoutStatus(queryPayload);

  if (!payoutTransaction && (serviceResponse.crn || serviceResponse.paymentId)) {
    payoutTransaction = await PayoutTransaction.findOne({
      where: serviceResponse.crn
        ? { reference_id: serviceResponse.crn }
        : { id: null },
    });
  }

  const updatedTransaction = payoutTransaction
    ? await upsertPayoutTransaction({
      existingTransaction: payoutTransaction,
      merchantId: payoutTransaction.merchant_id,
      beneficiaryId: payoutTransaction.beneficiary_id,
      normalizedResponse: serviceResponse,
      purpose: payoutTransaction.purpose,
    })
    : null;

  res.json({
    success: true,
    message: 'Sevenpay payout status fetched successfully',
    data: {
      crn: serviceResponse.crn || queryPayload.crn || null,
      paymentId: serviceResponse.paymentId || queryPayload.paymentId || null,
      status: serviceResponse.status,
      amount: serviceResponse.amount,
      serviceCharge: serviceResponse.serviceCharge,
      bankReferenceNo: serviceResponse.bankReferenceNo,
      rawResponse: serviceResponse.rawResponse,
      payoutTransactionId: updatedTransaction?.id || payoutTransaction?.id || null,
    },
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
};

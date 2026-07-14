const asyncHandler = require('express-async-handler');
const Beneficiary = require('../../models/Beneficiary');
const Ledger = require('../../models/Ledger');
const PayoutCharge = require('../../models/PayoutCharge');
const PayoutAuditLog = require('../../models/PayoutAuditLog');
const PayoutTransaction = require('../../models/PayoutTransaction');
const User = require('../../models/User');
const { Op } = require('sequelize');
const db = require('../../config/database');
const ledgerService = require('../../services/ledgerService');
const payoutReferenceService = require('../../services/payoutReferenceService');
const mxPayoutService = require('../../services/payments/mxPayoutService');
const {
  SERVICE_SETTING_KEYS,
  assertServiceEnabledOrRespond,
} = require('../../services/serviceSettingsService');
const { hasPermission, EMPLOYEE_PERMISSIONS, normalizeRole } = require('../../utils/permissions');
const { verifyTpinForUser } = require('../../services/tpinService');

const MX_TEST_MAX_AMOUNT = 100000;

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

const initiatePayout = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payout amount.',
    });
  }

  if (amount > MX_TEST_MAX_AMOUNT) {
    return res.status(400).json({
      success: false,
      message: `MeroRecharge payout amount cannot exceed ₹${MX_TEST_MAX_AMOUNT}.`,
    });
  }

  const { merchantId, merchant } = await resolveMerchantContext(req, req.body.merchant_id);
  if (!(await assertServiceEnabledOrRespond(res, SERVICE_SETTING_KEYS.MX_PAYOUT, merchant))) {
    return;
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

  const beneficiaryId = req.body.beneficiary_id;
  const beneficiary = await Beneficiary.findByPk(beneficiaryId);
  if (!beneficiary) {
    return res.status(404).json({
      success: false,
      message: 'Beneficiary not found.',
    });
  }

  if (Number(beneficiary.merchant_id) !== Number(merchantId)) {
    return res.status(403).json({
      success: false,
      message: 'Beneficiary does not belong to the selected merchant.',
    });
  }

  const serviceCharge = await resolvePayoutServiceCharge(amount);
  const totalAmount = +(amount + serviceCharge).toFixed(2);

  // Generate temporary requestId in case initiation fails before API returns one
  let localRequestId = await payoutReferenceService.getNextPayoutReference({ provider: 'mx_payout', userId: merchantId });

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
      reference_id: localRequestId,
      amount: amount.toFixed(2),
      status: 'PENDING',
      purpose: req.body.remark || req.body.purpose || 'Vendor payout',
      data: JSON.stringify({
        provider: 'Payout-M-X',
        localRequestId
      }),
      service_charge: serviceCharge,
      payout_provider: 'Payout-M-X',
    }, { transaction });

    await ledgerService.createPayoutEntry({
      userId: merchantId,
      payoutTransactionId: payoutTransaction.id,
      amount: totalAmount,
      description: `MeroRecharge payout ${localRequestId}`,
      metadata: {
        payout_provider: 'Payout-M-X',
        crn: localRequestId,
        beneficiary_id: beneficiary.id,
        beneficiary_name: beneficiary.beneficiary_name,
        account_number: beneficiary.account_number,
        ifsc_code: beneficiary.ifsc_code,
        bank_name: beneficiary.bank_name,
        service_charge: serviceCharge,
        payout_amount: amount,
      },
    }, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  // Call MeroRecharge submit API
  let serviceResponse;
  try {
    const apiPayload = {
      accountNo: beneficiary.account_number,
      bankIfsc: beneficiary.ifsc_code,
      payeeName: beneficiary.beneficiary_name,
      bankName: beneficiary.bank_name,
      amount: amount.toFixed(2),
      customerMobile: beneficiary.mobile_number || req.body.customerMobile || '9876543210',
      transferMode: req.body.transferMode || 'IMPS',
      remark: req.body.remark || req.body.purpose || 'Vendor payout',
      latitude: req.body.latitude || '22.5726',
      longitude: req.body.longitude || '88.3639'
    };

    serviceResponse = await mxPayoutService.initiatePayout(apiPayload);

    // Save final status and update reference_id to the actual requestId returned by the API
    const finalRequestId = serviceResponse.requestId || localRequestId;
    await payoutTransaction.update({
      reference_id: finalRequestId,
      status: serviceResponse.status,
      data: JSON.stringify({
        provider: 'Payout-M-X',
        localRequestId,
        apiRequestId: serviceResponse.requestId,
        apiPayoutId: serviceResponse.payoutId,
        latest: serviceResponse.rawResponse
      })
    });

    await PayoutAuditLog.create({
      payout_id: payoutTransaction.id,
      action: 'MX_PAYOUT_INITIATE',
      details: {
        reference_id: finalRequestId,
        status: serviceResponse.status,
        rawResponse: serviceResponse.rawResponse
      }
    });

  } catch (error) {
    // API Call Failed - transaction remains FAILED, and NO auto-refund is done!
    await payoutTransaction.update({
      status: 'FAILED',
      data: JSON.stringify({
        provider: 'Payout-M-X',
        localRequestId,
        error: error.message || error
      })
    });

    try {
      await PayoutAuditLog.create({
        payout_id: payoutTransaction.id,
        action: 'MX_PAYOUT_INITIATE_FAILED',
        details: {
          reference_id: localRequestId,
          status: 'FAILED',
          error: error.message || 'Initiation failed',
          rawResponse: error
        }
      });
    } catch (logError) {
      console.error('Failed to log failed MX initiation audit:', logError);
    }

    return res.status(502).json({
      success: false,
      message: error.message || 'Payout submission to gateway failed. Transaction marked FAILED.',
      reference_id: localRequestId
    });
  }

  res.json({
    success: serviceResponse.success,
    status: serviceResponse.status,
    message: serviceResponse.message || 'Payout request submitted',
    data: {
      requestId: payoutTransaction.reference_id,
      payoutId: serviceResponse.payoutId,
      status: serviceResponse.status,
      amount: amount.toFixed(2),
      serviceCharge,
      payoutTransactionId: payoutTransaction.id
    }
  });
});

const getPayoutStatus = asyncHandler(async (req, res) => {
  const payoutTransactionId = req.query.payout_transaction_id || req.body?.payout_transaction_id;
  const referenceId = req.query.reference_id || req.body?.reference_id || req.query.requestId || req.body?.requestId;

  let payoutTransaction = null;
  if (payoutTransactionId) {
    payoutTransaction = await PayoutTransaction.findByPk(payoutTransactionId);
  } else if (referenceId) {
    payoutTransaction = await PayoutTransaction.findOne({
      where: { reference_id: referenceId, payout_provider: 'Payout-M-X' }
    });
  }

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

  let serviceResponse;
  try {
    serviceResponse = await mxPayoutService.getPayoutStatus(payoutTransaction.reference_id);
    
    // Update status in db (no auto-refunds even if failed)
    const previousStatus = payoutTransaction.status;
    const newStatus = serviceResponse.status;

    let parsedData = parseJsonMaybe(payoutTransaction.data) || {};
    parsedData.latest = serviceResponse.rawResponse;

    await payoutTransaction.update({
      status: newStatus,
      data: JSON.stringify(parsedData)
    });

    await PayoutAuditLog.create({
      payout_id: payoutTransaction.id,
      action: 'MX_STATUS_CHECK',
      details: {
        reference_id: payoutTransaction.reference_id,
        from: previousStatus,
        to: newStatus,
        rawResponse: serviceResponse.rawResponse
      }
    });

  } catch (error) {
    return res.status(502).json({
      success: false,
      message: error.message || 'Failed to check status with gateway.',
      error
    });
  }

  res.json({
    success: true,
    message: 'MeroRecharge payout status fetched successfully',
    data: {
      requestId: payoutTransaction.reference_id,
      status: payoutTransaction.status,
      amount: payoutTransaction.amount,
      serviceCharge: payoutTransaction.service_charge,
      payoutTransactionId: payoutTransaction.id,
      rawResponse: serviceResponse.rawResponse
    }
  });
});

const manualRefundPayout = asyncHandler(async (req, res) => {
  if (!isPrivilegedUser(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'Admin or authorized employee access required',
    });
  }

  const payoutTransactionId = Number(req.body.payout_transaction_id || 0);
  const referenceId = req.body.reference_id || req.body.requestId || null;

  let payoutTransaction = null;
  if (payoutTransactionId > 0) {
    payoutTransaction = await PayoutTransaction.findByPk(payoutTransactionId);
  } else if (referenceId) {
    payoutTransaction = await PayoutTransaction.findOne({
      where: { reference_id: referenceId, payout_provider: 'Payout-M-X' }
    });
  }

  if (!payoutTransaction) {
    return res.status(404).json({
      success: false,
      message: 'Payout transaction not found.',
    });
  }

  if (payoutTransaction.payout_provider !== 'Payout-M-X') {
    return res.status(400).json({
      success: false,
      message: 'Manual refund on this endpoint is only supported for MeroRecharge (Payout-M-X) payouts.',
    });
  }

  if (String(payoutTransaction.status || '').toUpperCase() !== 'FAILED') {
    return res.status(400).json({
      success: false,
      message: 'Manual refund is allowed only when the payout status is FAILED.',
      status: payoutTransaction.status,
    });
  }

  // Prevent duplicate refunds
  const existingRefund = await Ledger.findOne({
    where: {
      transaction_type: 'payout_refund',
      reference_id: payoutTransaction.id,
      reference_table: 'PayoutTransactions',
    },
  });

  if (existingRefund) {
    return res.status(200).json({
      success: true,
      message: 'Refund already exists for this transaction; no action taken.',
      refundCreated: false,
      existingRefundLedgerId: existingRefund.id,
      payoutTransactionId: payoutTransaction.id,
    });
  }

  const amount = parseFloat(payoutTransaction.amount || 0);
  const serviceCharge = parseFloat(payoutTransaction.service_charge || 0);
  const refundAmount = amount + serviceCharge;

  const refundEntry = await ledgerService.createLedgerEntry({
    userId: payoutTransaction.merchant_id,
    transactionType: 'payout_refund',
    referenceId: payoutTransaction.id,
    referenceTable: 'PayoutTransactions',
    description: `Manual refund for failed MeroRecharge payout ${payoutTransaction.reference_id}`,
    credit: refundAmount,
    metadata: {
      payout_provider: 'Payout-M-X',
      payout_reference: payoutTransaction.reference_id,
      original_payout_amount: String(amount),
      original_service_charge: String(serviceCharge),
      refund_source: 'admin_manual',
      performed_by: req.user?.id,
      performed_role: req.user?.role,
    },
  });

  let snapshot = parseJsonMaybe(payoutTransaction.data) || {};
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
    action: 'MX_MANUAL_REFUND',
    details: {
      reference_id: payoutTransaction.reference_id,
      requestedBy: req.user?.id,
      requestedRole: req.user?.role,
      refundLedgerId: refundEntry?.id || null,
      refundAmount,
      payoutStatus: payoutTransaction.status,
    },
  });

  res.json({
    success: true,
    message: 'MeroRecharge manual refund created successfully.',
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
      where: { reference_id: requestId || reference_id, payout_provider: 'Payout-M-X' }
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
      txn = await PayoutTransaction.findOne({ where: { id: payout_id, payout_provider: 'Payout-M-X' } });
    } else if (requestId || reference_id) {
      txn = await PayoutTransaction.findOne({ where: { reference_id: requestId || reference_id, payout_provider: 'Payout-M-X' } });
    }

    if (txn) {
      const parsedData = parseJsonMaybe(txn.data) || {};
      const virtualLogs = [];

      virtualLogs.push({
        id: `virtual-init-${txn.id}`,
        payout_id: txn.id,
        action: 'MX_PAYOUT_INITIATE_FALLBACK',
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
          action: 'MX_STATUS_UPDATE_FALLBACK',
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

const getPayoutReference = asyncHandler(async (req, res) => {
  const { merchantId } = await resolveMerchantContext(req, req.query.merchant_id || req.body?.merchant_id);
  const reference = await payoutReferenceService.getNextPayoutReference({ provider: 'mx_payout', userId: merchantId || req.user?.id });

  res.status(200).json({
    success: true,
    reference,
    requestId: reference,
    crn: reference,
    merchantRefId: reference,
  });
});

const createBeneficiary = asyncHandler(async (req, res) => {
  const { merchantId } = await resolveMerchantContext(req, req.body.merchant_id);
  const { beneficiary_name, name, account_number, accountNo, ifsc_code, bankIfsc, bank_name, bankName, mobile_number, mobile, email } = req.body;

  const targetName = beneficiary_name || name;
  const targetAccount = account_number || accountNo;
  const targetIfsc = ifsc_code || bankIfsc;
  const targetBankName = bank_name || bankName;

  if (!merchantId || !targetName || !targetAccount || !targetIfsc || !targetBankName) {
    return res.status(400).json({
      success: false,
      message: 'merchant_id, beneficiary name, account number, IFSC code, and bank name are required.',
    });
  }

  let beneficiary = await Beneficiary.findOne({
    where: {
      merchant_id: merchantId,
      account_number: targetAccount,
      ifsc_code: targetIfsc
    }
  });

  if (beneficiary) {
    const updates = {
      beneficiary_name: targetName,
      bank_name: targetBankName,
      mobile_number: mobile_number || mobile || '',
      email: email || '',
      status: 'active'
    };
    await beneficiary.update(updates);
  } else {
    beneficiary = await Beneficiary.create({
      merchant_id: merchantId,
      beneficiary_name: targetName,
      account_number: targetAccount,
      ifsc_code: targetIfsc,
      bank_name: targetBankName,
      mobile_number: mobile_number || mobile || '',
      email: email || '',
      status: 'active'
    });
  }

  res.status(201).json({
    success: true,
    data: beneficiary
  });
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

const deleteBeneficiary = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const beneficiary = await Beneficiary.findByPk(id);

  if (!beneficiary) {
    return res.status(404).json({ success: false, message: 'Beneficiary not found' });
  }

  if (!canActForMerchant(req, beneficiary.merchant_id)) {
    return res.status(403).json({ success: false, message: 'You are not allowed to manage this beneficiary.' });
  }

  await beneficiary.update({ status: 'inactive' });
  res.status(200).json({
    success: true,
    message: 'Beneficiary deleted successfully',
  });
});

module.exports = {
  initiatePayout,
  getPayoutStatus,
  manualRefundPayout,
  getPayoutReference,
  createBeneficiary,
  listBeneficiaries,
  deleteBeneficiary,
  getPayoutAuditLogsByPayout,
};


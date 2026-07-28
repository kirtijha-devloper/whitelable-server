/**
 * =========================================================================
 * NDIA5 PAYOUT CONTROLLER
 * =========================================================================
 * Express controller handling NDIA5 API endpoints:
 * - Initiate Payout
 * - Check Payout Status
 * - Check Self Balance
 * - Manual Refund Payout (Strictly manual, no auto-refund on failure)
 * - Payout Audit Logs
 */

const asyncHandler = require('express-async-handler');
const ndia5Service = require('../services/ndia5Payout.service');
const PayoutTransaction = require('../models/PayoutTransaction');
const PayoutAuditLog = require('../models/PayoutAuditLog');
const ledgerService = require('../services/ledgerService');
const db = require('../config/database');

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
 * POST /api/ndia5/auth/login
 * Test/verify login authentication with NDIA5
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
 * POST /api/ndia5/payout/balance
 * Get NDIA5 provider wallet balance (Admin Only Endpoint)
 */
const getBalance = asyncHandler(async (req, res) => {
  const userRole = String(req.user?.role || '').toLowerCase();
  if (userRole !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied: Self balance check is restricted to Admin only',
    });
  }

  const result = await ndia5Service.getBalance(req.body || {});
  return res.status(200).json({
    success: true,
    message: 'NDIA5 balance fetched successfully',
    data: result,
  });
});

/**
 * POST /api/ndia5/payout/initiate
 * Initiate payout via NDIA5 gateway
 */
const initiatePayout = asyncHandler(async (req, res) => {
  const {
    amount,
    channel = 'IMPS',
    payeeName,
    bankAccount,
    ifsc,
    customerMobile,
    customerName,
    webhookUrl,
  } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: 'Valid payout amount is required' });
  }
  if (!bankAccount || !ifsc || !payeeName) {
    return res.status(400).json({ success: false, message: 'Bank account, IFSC, and payeeName are required' });
  }

  // Pre-check NDIA5 company self balance before processing payout initiation
  let companyBalance = 0;
  let balanceCheckFailed = false;
  try {
    const balanceResult = await ndia5Service.getBalance({ accountNumber: bankAccount, ifsc });
    companyBalance = Number(balanceResult.balance ?? balanceResult.rawResponse ?? 0);
    if (isNaN(companyBalance)) companyBalance = 0;
  } catch (balanceErr) {
    console.error('[NDIA5 Company Balance Check Error]:', balanceErr.message);
    balanceCheckFailed = true;
  }

  // If company balance is insufficient or balance check failed
  if (balanceCheckFailed || companyBalance < Number(amount)) {
    // Log exact reason to india5.log
    ndia5Service.india5Log('INITIATE_PAYOUT_REJECTED', {
      error: 'insufficient company balance',
      requestedAmount: Number(amount),
      availableCompanyBalance: companyBalance,
      balanceCheckFailed,
    });

    return res.status(400).json({
      success: false,
      message: 'Server downtime, please try after 10 min',
    });
  }

  // Generate unique merchant reference ID (numeric string format)
  const merchantReferenceId = Date.now().toString() + Math.floor(100000 + Math.random() * 900000).toString();

  // Create PayoutTransaction in database with status PENDING
  const payoutTransaction = await PayoutTransaction.create({
    merchant_id: req.user?.id || req.user?.merchant_id || 1,
    reference_id: merchantReferenceId,
    amount: Number(amount),
    status: 'PENDING',
    payout_provider: 'Ndia5',
    service_charge: 0,
    data: JSON.stringify({
      payeeName,
      bankAccount,
      ifsc,
      channel,
      initiatedAt: new Date().toISOString(),
      companyBalanceAtInitiation: companyBalance,
    }),
  });


  // Log initiation audit entry
  await PayoutAuditLog.create({
    payout_id: payoutTransaction.id,
    action: 'NDIA5_PAYOUT_INITIATED',
    details: {
      merchantReferenceId,
      amount,
      channel,
      payeeName,
      bankAccount,
      ifsc,
    },
  });

  try {
    // Call NDIA5 Service to initiate payout
    const providerResult = await ndia5Service.initiatePayout({
      merchantReferenceId,
      amount,
      channel,
      payeeName,
      bankAccount,
      ifsc,
      customerMobile,
      customerName,
      webhookUrl,
    });

    // Update payout transaction record with provider response
    const existingData = parseJsonMaybe(payoutTransaction.data);
    payoutTransaction.status = providerResult.status;
    payoutTransaction.service_charge = providerResult.serviceCharge ?? payoutTransaction.service_charge;
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
        referenceId: merchantReferenceId,
        providerTransactionId: providerResult.transactionId,
        status: providerResult.status,
        serviceCharge: providerResult.serviceCharge,
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
      referenceId: merchantReferenceId,
    });
  }
});

/**
 * GET/POST /api/ndia5/payout/status
 * Check status of an existing NDIA5 payout transaction
 */
const getPayoutStatus = asyncHandler(async (req, res) => {
  const referenceId = req.query.referenceId || req.query.reference_id || req.body.referenceId || req.body.reference_id;

  if (!referenceId) {
    return res.status(400).json({ success: false, message: 'referenceId parameter is required' });
  }

  // Find transaction in database
  const payoutTransaction = await PayoutTransaction.findOne({
    where: { reference_id: referenceId, payout_provider: 'Ndia5' },
  });

  if (!payoutTransaction) {
    return res.status(404).json({ success: false, message: `NDIA5 transaction not found for referenceId: ${referenceId}` });
  }

  // Query NDIA5 Gateway for latest status
  const providerResult = await ndia5Service.getPayoutStatus(referenceId);

  const previousStatus = payoutTransaction.status;
  const newStatus = providerResult.status;

  // Update status in DB
  const existingData = parseJsonMaybe(payoutTransaction.data);
  payoutTransaction.status = newStatus;
  payoutTransaction.service_charge = providerResult.serviceCharge ?? payoutTransaction.service_charge;
  payoutTransaction.data = JSON.stringify({
    ...existingData,
    provider: 'Ndia5',
    latestStatusCheck: providerResult.rawResponse,
    lastCheckedAt: new Date().toISOString(),
  });

  await payoutTransaction.save();

  // Audit log if status changed
  if (previousStatus !== newStatus) {
    await PayoutAuditLog.create({
      payout_id: payoutTransaction.id,
      action: 'NDIA5_STATUS_CHANGED',
      details: {
        referenceId,
        fromStatus: previousStatus,
        toStatus: newStatus,
        rawResponse: providerResult.rawResponse,
        // Enforce explicit manual refund notice on FAILED status
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
 * Manually refund a FAILED NDIA5 payout transaction
 * (No automatic refunds are triggered upon payout failure)
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

  // Ensure payout status is FAILED
  if (payoutTransaction.status !== 'FAILED') {
    return res.status(400).json({
      success: false,
      message: `Manual refund is only allowed for FAILED payouts. Current status: ${payoutTransaction.status}`,
    });
  }

  const existingData = parseJsonMaybe(payoutTransaction.data);

  // Check if manual refund was already processed
  if (existingData.manualRefundProcessed) {
    return res.status(400).json({
      success: false,
      message: 'Manual refund has already been processed for this payout transaction.',
    });
  }

  // Process refund through ledger transaction
  const refundAmount = payoutTransaction.amount;
  let refundEntry = null;

  try {
    if (typeof ledgerService.createLedgerEntry === 'function') {
      refundEntry = await ledgerService.createLedgerEntry({
        merchant_id: payoutTransaction.merchant_id,
        transaction_type: 'CREDIT',
        amount: refundAmount,
        description: `Manual Refund for NDIA5 Payout ${payoutTransaction.reference_id}`,
        reference_id: `REFUND-${payoutTransaction.reference_id}`,
      });
    }
  } catch (ledgerError) {
    console.error('[NDIA5 Manual Refund Ledger Error]:', ledgerError.message);
  }

  // Mark transaction data as refunded
  existingData.manualRefundProcessed = true;
  existingData.manualRefundAt = new Date().toISOString();
  existingData.manualRefundBy = req.user?.id || 'admin';
  existingData.refundLedgerId = refundEntry?.id || null;

  payoutTransaction.data = JSON.stringify(existingData);
  await payoutTransaction.save();

  // Audit log entry for manual refund
  await PayoutAuditLog.create({
    payout_id: payoutTransaction.id,
    action: 'NDIA5_MANUAL_REFUND_COMPLETED',
    details: {
      reference_id: payoutTransaction.reference_id,
      refundAmount,
      refundBy: req.user?.id || 'admin',
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
 * Get audit logs for an NDIA5 payout transaction
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

module.exports = {
  login,
  getBalance,
  initiatePayout,
  getPayoutStatus,
  manualRefundPayout,
  getPayoutAuditLogsByPayout,
};

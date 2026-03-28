const asyncHandler = require('express-async-handler');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const billAvenueService = require('../../../services/cc/billAvenue/billAvenueService');
const billAvenueConfig = require('../../../config/billavenue');
const BillAvenuePayment = require('../../../models/BillAvenuePayment');
const BillAvenueBillFetch = require('../../../models/BillAvenueBillFetch');
const BbpsCcChargeRule = require('../../../models/BbpsCcChargeRule');
const User = require('../../../models/User');
const ledgerService = require('../../../services/ledgerService');

// ─── Logging ────────────────────────────────────────────────────────────────
const logFile = path.join(__dirname, '../../../logs/billAvenue.log');
function fileLog(message) {
  const timestamp = new Date().toISOString();
  fs.appendFile(logFile, `[${timestamp}] ${message}\n`, (err) => {
    if (err) console.error('[billAvenue] log write failed', err);
  });
}

// ─── Charge calculation (reuses BbpsCcChargeRule table) ─────────────────────
async function calculateCharge(txnAmount) {
  const chargeRule = await BbpsCcChargeRule.findOne({
    where: {
      is_active: true,
      from_amount: { [Op.lte]: txnAmount },
      to_amount: { [Op.gte]: txnAmount },
    },
    order: [['from_amount', 'DESC']],
  });

  let chargeAmount = 20; // default ₹20
  if (chargeRule) {
    if (chargeRule.rate_type === 'flat') {
      chargeAmount = parseFloat(chargeRule.rate);
    } else {
      chargeAmount = parseFloat((txnAmount * parseFloat(chargeRule.rate)) / 100.0);
    }
  }

  return chargeAmount;
}

// ─── Balance check ──────────────────────────────────────────────────────────
async function ensureSufficientBalance(userId, txnAmount) {
  const chargeAmount = await calculateCharge(txnAmount);
  const minimumRequired = txnAmount + chargeAmount + 30; // 30 buffer
  const currentBalance = await ledgerService.getAvailableBalance(userId);

  return {
    currentBalance,
    chargeAmount,
    minimumRequired,
    isSufficient: currentBalance >= minimumRequired,
  };
}

// ─── Helper: extract response code from parsed BillAvenue XML ───────────────
function getResponseCode(parsed) {
  // BillAvenue wraps responses differently per endpoint.
  // Walk common paths to find responseCode.
  if (!parsed) return null;
  const root = Object.values(parsed)[0]; // first child of root
  if (typeof root === 'string') return null;
  return root?.responseCode || root?.errorCode || null;
}

function getTransactionRefId(parsed) {
  if (!parsed) return null;
  const root = Object.values(parsed)[0];
  if (typeof root === 'string') return null;
  return root?.transactionRefId || root?.txnRefId || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/bill-avenue/billers
// ═══════════════════════════════════════════════════════════════════════════
const getBillers = asyncHandler(async (req, res) => {
  try {
    // Staging environment: return hardcoded test billers
    const isStaging = billAvenueConfig.apiUrl && billAvenueConfig.apiUrl.includes('stgapi');
    if (isStaging) {
      return res.status(200).json({
        success: true,
        data: {
          billers: [
            { billerId: 'OTME00005XXZ43', billerName: 'Test Biller 1' },
            { billerId: 'biller2', billerName: 'Biller 2' },
            { billerId: 'biller3', billerName: 'Biller 3' },
          ],
        },
      });
    }

    const result = await billAvenueService.getBillerInfo();
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[billAvenue] getBillers error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bill-avenue/fetch-bill
// Body: { billerId, customerParams: { param1: value, ... }, amount }
// ═══════════════════════════════════════════════════════════════════════════
const fetchBill = asyncHandler(async (req, res) => {
  try {
    const { billerId, customerParams, amount } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    if (!billerId || !customerParams) {
      return res.status(400).json({ success: false, message: 'Required: billerId, customerParams' });
    }

    const txnAmount = amount ? parseFloat(amount) : null;

    // If an amount is provided, do a balance pre-check
    if (txnAmount && txnAmount > 0) {
      const balanceCheck = await ensureSufficientBalance(userId, txnAmount);
      if (!balanceCheck.isSufficient) {
        return res.status(400).json({
          success: false,
          message: `Insufficient balance. Minimum required is ₹${balanceCheck.minimumRequired.toFixed(2)} (transaction + charge + buffer).`,
          currentBalance: balanceCheck.currentBalance,
          requiredBalance: balanceCheck.minimumRequired,
          requiredCharge: balanceCheck.chargeAmount,
        });
      }
    }

    const result = await billAvenueService.fetchBill({
      billerId,
      customerParams,
      amount: txnAmount,
    });

    fileLog(`fetchBill billerId=${billerId} response=${JSON.stringify(result)}`);

    // Save the bill fetch record
    await BillAvenueBillFetch.create({
      user_id: userId,
      biller_id: billerId,
      customer_params: customerParams,
      amount: txnAmount,
      response: result,
      status: 'completed',
    });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[billAvenue] fetchBill error:', error.message);
    fileLog(`fetchBill error: ${error.message}`);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bill-avenue/pay
// Body: { billerId, customerParams, amount, paymentMode, quickPay, splitPay, ccf }
// ═══════════════════════════════════════════════════════════════════════════
const payBill = asyncHandler(async (req, res) => {
  try {
    const { billerId, customerParams, amount, paymentMode, quickPay, splitPay, ccf } = req.body;

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (!billerId || !customerParams || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Required: billerId, customerParams, amount',
      });
    }

    const txnAmount = parseFloat(amount);
    if (Number.isNaN(txnAmount) || txnAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // ── Balance check ───────────────────────────────────────────────────
    const balanceCheck = await ensureSufficientBalance(userId, txnAmount);
    if (!balanceCheck.isSufficient) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Minimum required is ₹${balanceCheck.minimumRequired.toFixed(2)} (transaction + charge + buffer).`,
        currentBalance: balanceCheck.currentBalance,
        requiredBalance: balanceCheck.minimumRequired,
        requiredCharge: balanceCheck.chargeAmount,
      });
    }

    // ── Create pending payment record ───────────────────────────────────
    const payment = await BillAvenuePayment.create({
      user_id: userId,
      biller_id: billerId,
      customer_params: customerParams,
      transaction_amount: txnAmount,
      payment_mode: paymentMode || 'Cash',
      status: 'pending',
    });

    // ── Step 1: Ledger debit (before calling BillAvenue) ────────────────
    let ledgerEntry = null;
    if (userId && txnAmount > 0) {
      ledgerEntry = await ledgerService.createLedgerEntry({
        userId,
        transactionType: 'billavenue_payment',
        referenceId: payment.id,
        referenceTable: 'BillAvenuePayments',
        description: `BillAvenue CC bill payment — biller: ${billerId}`,
        debit: txnAmount,
        status: 'pending',
        metadata: {
          biller_id: billerId,
          payment_mode: paymentMode || 'Cash',
        },
      });
    }

    // ── Step 2: Call BillAvenue API ──────────────────────────────────────
    let result;
    try {
      result = await billAvenueService.payBill({
        billerId,
        customerParams,
        amount: txnAmount,
        paymentMode: paymentMode || 'Cash',
        quickPay,
        splitPay,
        ccf,
      });
    } catch (apiError) {
      // API call itself failed (network error, timeout, etc.)
      fileLog(`payBill API error billerId=${billerId}: ${apiError.message}`);

      // Reverse the ledger debit
      await ledgerService.createLedgerEntry({
        userId,
        transactionType: 'billavenue_payment_reversal',
        referenceId: payment.id,
        referenceTable: 'BillAvenuePayments',
        description: `Reversed — BillAvenue API error: ${apiError.message}`,
        credit: txnAmount,
        status: 'completed',
        metadata: {
          biller_id: billerId,
          original_ledger_id: ledgerEntry?.id,
          error: apiError.message,
        },
      });

      if (ledgerEntry) {
        ledgerEntry.status = 'reversed';
        await ledgerEntry.save();
      }

      await payment.update({ status: 'failed', response: { error: apiError.message } });

      return res.status(500).json({ success: false, message: 'BillAvenue API call failed. Amount reversed.' });
    }

    fileLog(`payBill result billerId=${billerId}: ${JSON.stringify(result)}`);

    const responseCode = getResponseCode(result);
    const transactionRefId = getTransactionRefId(result);
    const isSuccess = responseCode === '000';

    // Charge calculation
    const chargeAmount = await calculateCharge(txnAmount);

    // Update payment record
    await payment.update({
      transaction_ref_id: transactionRefId,
      status: isSuccess ? 'success' : 'failed',
      response_code: responseCode,
      response: result,
      charge_amount: chargeAmount,
    });

    // ── Step 3: Finalise or reverse ─────────────────────────────────────
    if (isSuccess) {
      if (ledgerEntry) {
        ledgerEntry.status = 'completed';
        ledgerEntry.transaction_id = transactionRefId || null;
        ledgerEntry.metadata = JSON.stringify({
          biller_id: billerId,
          payment_mode: paymentMode || 'Cash',
          response_code: responseCode,
          transaction_ref_id: transactionRefId,
        });
        await ledgerEntry.save();
      }

      // Deduct charge after successful payment
      if (chargeAmount > 0 && userId) {
        await ledgerService.createLedgerEntry({
          userId,
          transactionType: 'billavenue_charge',
          transactionId: transactionRefId || null,
          referenceId: payment.id,
          referenceTable: 'BillAvenuePayments',
          description: `BillAvenue CC payment charge — ₹${chargeAmount}`,
          debit: chargeAmount,
          status: 'completed',
          metadata: {
            biller_id: billerId,
            charge_amount: chargeAmount,
            transaction_ref_id: transactionRefId,
          },
        });
      }
    } else {
      // Payment failed — reverse the ledger debit
      fileLog(`payBill failed billerId=${billerId} responseCode=${responseCode} response=${JSON.stringify(result)}`);

      await ledgerService.createLedgerEntry({
        userId,
        transactionType: 'billavenue_payment_reversal',
        transactionId: transactionRefId || null,
        referenceId: payment.id,
        referenceTable: 'BillAvenuePayments',
        description: `Reversed — BillAvenue payment failed (code: ${responseCode || 'unknown'})`,
        credit: txnAmount,
        status: 'completed',
        metadata: {
          biller_id: billerId,
          original_ledger_id: ledgerEntry?.id,
          response_code: responseCode,
          transaction_ref_id: transactionRefId,
        },
      });

      if (ledgerEntry) {
        ledgerEntry.status = 'reversed';
        await ledgerEntry.save();
      }
    }

    return res.status(200).json({
      success:          isSuccess,
      message:          isSuccess ? 'Bill payment successful' : 'Bill payment failed',
      transactionRefId,
      responseCode,
      data:             result,
    });
  } catch (error) {
    console.error('[billAvenue] payBill error:', error.message);
    fileLog(`payBill error: ${error.message}`);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/bill-avenue/payments
// List BillAvenue payment records (admin sees all, user sees own)
// ═══════════════════════════════════════════════════════════════════════════
const getPayments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const offset = (page - 1) * limit;

  const { billerId, transactionRefId, status } = req.query;

  const where = {};
  if (req.user?.role !== 'admin') {
    where.user_id = req.user?.id;
  }
  if (billerId) where.biller_id = billerId;
  if (transactionRefId) where.transaction_ref_id = { [Op.iLike]: `%${transactionRefId}%` };
  if (status) where.status = status;

  const { count, rows } = await BillAvenuePayment.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });

  return res.status(200).json({ success: true, count, data: rows });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/bill-avenue/payments/:id
// ═══════════════════════════════════════════════════════════════════════════
const getPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const record = await BillAvenuePayment.findByPk(id);
  if (!record) {
    return res.status(404).json({ success: false, message: 'Payment record not found' });
  }
  if (req.user?.role !== 'admin' && record.user_id !== req.user?.id) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  return res.status(200).json({ success: true, data: record });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bill-avenue/complaint
// Body: { billerId, transactionRefId, reason, description }
// ═══════════════════════════════════════════════════════════════════════════
const registerComplaint = asyncHandler(async (req, res) => {
  try {
    const { billerId, transactionRefId, reason, description } = req.body;

    if (!billerId || !transactionRefId) {
      return res.status(400).json({ success: false, message: 'Required: billerId, transactionRefId' });
    }

    const result = await billAvenueService.registerComplaint({
      billerId,
      transactionRefId,
      reason,
      description,
    });

    fileLog(`registerComplaint billerId=${billerId} txnRef=${transactionRefId} response=${JSON.stringify(result)}`);

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[billAvenue] registerComplaint error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/bill-avenue/transaction-status
// Body: { transactionRefId }
// ═══════════════════════════════════════════════════════════════════════════
const getTransactionStatus = asyncHandler(async (req, res) => {
  try {
    const { transactionRefId } = req.body;

    if (!transactionRefId) {
      return res.status(400).json({ success: false, message: 'Required: transactionRefId' });
    }

    const result = await billAvenueService.getTransactionStatus({ transactionRefId });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[billAvenue] getTransactionStatus error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

module.exports = {
  getBillers,
  fetchBill,
  payBill,
  getPayments,
  getPayment,
  registerComplaint,
  getTransactionStatus,
};

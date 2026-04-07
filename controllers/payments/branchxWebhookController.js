const fs = require('fs');
const path = require('path');
const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const db = require('../../config/database');
const PayoutTransaction = require('../../models/PayoutTransaction');
const PayoutAuditLog = require('../../models/PayoutAuditLog');
const WalletTransaction = require('../../models/WalletTransaction');
const Ledger = require('../../models/Ledger');
const ledgerService = require('../../services/ledgerService');

const callbackLogFile = path.resolve(__dirname, '../../logs/branchx-payout-callback.log');

function logBranchxCallback(data) {
  try {
    const line = `${new Date().toISOString()} - ${JSON.stringify(data)}\n`;
    fs.appendFileSync(callbackLogFile, line, 'utf8');
  } catch (err) {
    console.error('Failed to write BranchX callback log:', err);
  }
}

function normalizeBranchxStatus(statusRaw) {
  if (!statusRaw) return 'PENDING';
  const s = statusRaw.toString().trim().toUpperCase();
  if (['SUCCESS', 'COMPLETED'].includes(s)) return 'SUCCESS';
  if (['FAILED', 'FAILURE', 'REJECTED', 'CANCELLED', 'REVERSED'].includes(s)) return 'FAILED';
  if (['PENDING', 'PROCESSING', 'IN_PROGRESS'].includes(s)) return 'PENDING';
  return s;
}

const handleBranchxPayoutCallback = asyncHandler(async (req, res) => {
  const payload = (req.method === 'GET' ? req.query : req.body) || {};
  logBranchxCallback(payload);

  if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    return res.status(400).json({ success: false, message: 'Empty callback payload' });
  }

  const status = normalizeBranchxStatus(payload.status || payload.Status);
  const referenceCandidates = [payload.requestId, payload.requestid, payload.opRefId, payload.oprefid, payload.apiTxnId, payload.apitxnid].filter(Boolean);

  if (!referenceCandidates.length) {
    return res.status(400).json({ success: false, message: 'Missing identifier in callback payload' });
  }

  let payoutTransaction = null;
  for (const ref of referenceCandidates) {
    if (payoutTransaction) break;
    payoutTransaction = await PayoutTransaction.findOne({ where: { reference_id: ref } });
  }

  if (!payoutTransaction) {
    return res.status(404).json({ success: false, message: 'Payout transaction not found for callback payload', callbackPayload: payload });
  }

  const trx = await db.transaction();
  try {
    const locked = await PayoutTransaction.findByPk(payoutTransaction.id, { transaction: trx, lock: trx.LOCK.UPDATE });
    if (!locked) {
      await trx.rollback();
      return res.status(500).json({ success: false, message: 'Failed to lock payout transaction' });
    }

    const previousStatus = (locked.status || '').toString().toUpperCase();
    const newStatus = status;

    let parsedData = {};
    try {
      parsedData = locked.data ? JSON.parse(locked.data) : {};
    } catch (ignore) {
      parsedData = { original: locked.data };
    }

    parsedData.callback = payload;

    const payloadStr = JSON.stringify(payload);

    await locked.update({
      status: newStatus,
      callback_status: newStatus,
      callback_data: payloadStr,
      callback_received_at: new Date(),
      data: JSON.stringify(parsedData)
    }, { transaction: trx });

    if ((previousStatus === 'PENDING' || previousStatus === 'SUCCESS') && newStatus === 'FAILED') {
      const existingRefund = await Ledger.findOne({
        where: {
          transaction_type: 'payout_refund',
          reference_id: locked.id,
          reference_table: 'PayoutTransactions',
        },
        transaction: trx,
      });

      if (!existingRefund) {
        const refundAmount = parseFloat(locked.amount || 0) + parseFloat(locked.service_charge || 0);
        await ledgerService.createLedgerEntry({
          userId: locked.merchant_id,
          transactionType: 'payout_refund',
          referenceId: locked.id,
          referenceTable: 'PayoutTransactions',
          description: `Refund for failed BranchX payout ${locked.reference_id || locked.id}`,
          credit: refundAmount,
        }, { transaction: trx });
      }

      const walletTx = await WalletTransaction.findOne({
        where: {
          source: 'branchx',
          reference_id: locked.reference_id
        },
        order: [['createdAt', 'DESC']],
        transaction: trx
      });

      if (walletTx) {
        walletTx.status = 'failed';
        walletTx.reason = `BranchX payout failed: ${payload.message || payload.msg || 'Transaction failed'}`;
        await walletTx.save({ transaction: trx });
      }
    }

    if (previousStatus !== newStatus) {
      await PayoutAuditLog.create({
        payout_id: locked.id,
        action: 'BRANCHX_CALLBACK_STATUS_UPDATE',
        details: {
          from: previousStatus,
          to: newStatus,
          callback: payload
        }
      }, { transaction: trx });
    }

    await trx.commit();

    return res.status(200).json({
      success: true,
      message: 'BranchX callback processed successfully',
      payoutTransactionId: locked.id,
      status: newStatus
    });
  } catch (error) {
    await trx.rollback();
    console.error('[BranchX callback] error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Callback processing failed', error });
  }
});

module.exports = {
  handleBranchxPayoutCallback,
};

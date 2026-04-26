const fs = require('fs');
const path = require('path');
const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const db = require('../../config/database');
const PayoutTransaction = require('../../models/PayoutTransaction');
const PayoutAuditLog = require('../../models/PayoutAuditLog');
const Ledger = require('../../models/Ledger');
const ledgerService = require('../../services/ledgerService');

const callbackLogFile = path.resolve(__dirname, '../../logs/branchx-payout-callback.log');

function ensureLogDir() {
  const logDir = path.dirname(callbackLogFile);
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to ensure callback log directory exists:', err);
  }
}

function logBranchxCallback(data, req) {
  try {
    ensureLogDir();
    const branchxStatusCode = data.statuscode || data.statusCode || data.status_code || data.code || data.responseCode || data.response_code || null;
    const entry = {
      receivedAt: new Date().toISOString(),
      method: req?.method || null,
      path: req?.originalUrl || null,
      ip: req?.ip || (req?.connection?.remoteAddress || null),
      branchxStatusCode,
      rawPayload: data,
    };
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(callbackLogFile, line, 'utf8');
  } catch (err) {
    console.error('Failed to write BranchX callback log:', err);
    // fallback to webhook auth log if branchx callback log can't be written
    try {
      const fallback = path.join(__dirname, '../../logs/webhookAuth.log');
      const fallbackEntry = {
        receivedAt: new Date().toISOString(),
        fallback: true,
        rawPayload: data,
      };
      fs.appendFileSync(fallback, `${JSON.stringify(fallbackEntry)}\n`, 'utf8');
    } catch (fallbackErr) {
      console.error('Failed to write fallback webhookAuth log:', fallbackErr);
    }
  }
}

function logBranchxEvent(message) {
  try {
    ensureLogDir();
    const line = `${new Date().toISOString()} - [EVENT] ${message}\n`;
    fs.appendFileSync(callbackLogFile, line, 'utf8');
  } catch (err) {
    console.error('Failed to write BranchX event log:', err);
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
  logBranchxCallback(payload, req);

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
    logBranchxEvent(`NOT PROCESSED — no payout transaction found for refs: ${referenceCandidates.join(', ')}`);
    return res.status(404).json({ success: false, message: 'Payout transaction not found for callback payload', callbackPayload: payload });
  }

  logBranchxEvent(`Found payout transaction id=${payoutTransaction.id} ref=${payoutTransaction.reference_id} currentStatus=${payoutTransaction.status} incomingStatus=${status}`);

  const trx = await db.transaction();
  try {
    const locked = await PayoutTransaction.findByPk(payoutTransaction.id, { transaction: trx, lock: trx.LOCK.UPDATE });
    if (!locked) {
      await trx.rollback();
      return res.status(500).json({ success: false, message: 'Failed to lock payout transaction' });
    }

    const previousStatus = (locked.status || '').toString().toUpperCase();
    const newStatus = status;

    if (previousStatus === newStatus) {
      logBranchxEvent(`SKIPPED — payout id=${locked.id} already in status=${previousStatus}`);
    } else {
      logBranchxEvent(`PROCESSING — payout id=${locked.id} status change: ${previousStatus} → ${newStatus}`);
    }

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

    logBranchxEvent(`PROCESSED successfully — payout id=${locked.id} finalStatus=${newStatus}`);

    const branchxStatusCode = payload.statuscode || payload.statusCode || payload.status_code || payload.code || payload.responseCode || payload.response_code || null;
    return res.status(200).json({
      success: true,
      message: 'BranchX callback processed successfully',
      payoutTransactionId: locked.id,
      status: newStatus,
      branchxStatusCode,
      callbackPayload: payload,
      previousStatus,
      newStatus
    });
  } catch (error) {
    await trx.rollback();
    logBranchxEvent(`FAILED — payout id=${payoutTransaction.id} error: ${error.message || error}`);
    return res.status(500).json({ success: false, message: error.message || 'Callback processing failed', error });
  }
});

module.exports = {
  handleBranchxPayoutCallback,
};

const fs = require('fs');
const path = require('path');
const asyncHandler = require('express-async-handler');
const db = require('../../config/database');
const PayoutTransaction = require('../../models/PayoutTransaction');
const PayoutAuditLog = require('../../models/PayoutAuditLog');
const mxPayoutService = require('../../services/payments/mxPayoutService');

const CALLBACK_LOG_FILE = path.resolve(__dirname, '../../logs/mx-payout-callback.log');

function ensureLogDir() {
  const logDir = path.dirname(CALLBACK_LOG_FILE);
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to ensure MX callback log directory exists:', err);
  }
}

function logMxCallback(data, req) {
  try {
    ensureLogDir();
    const entry = {
      receivedAt: new Date().toISOString(),
      method: req?.method || null,
      path: req?.originalUrl || null,
      ip: req?.ip || (req?.connection?.remoteAddress || null),
      payload: data,
    };
    fs.appendFileSync(CALLBACK_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.error('Failed to write MX callback log:', err);
  }
}

const handleMxCallback = asyncHandler(async (req, res) => {
  const payload = req.body;
  logMxCallback(payload, req);

  if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    return res.status(400).json({ success: false, message: 'Empty callback payload' });
  }

  // MeroRecharge payload schema contains result.requestId and status
  const rawStatus = payload.status || payload.result?.status;
  const requestId = payload.requestId || payload.result?.requestId || payload.result?.requestid;

  if (!requestId) {
    return res.status(400).json({ success: false, message: 'Missing requestId in callback payload' });
  }

  const normalizedStatus = mxPayoutService.normalizeStatus(rawStatus);

  const payoutTransaction = await PayoutTransaction.findOne({
    where: { reference_id: requestId, payout_provider: 'Payout-M-X' }
  });

  if (!payoutTransaction) {
    return res.status(404).json({
      success: true, // Return 200/204 to provider to acknowledge callback receipt
      message: `No matching payout transaction found for requestId ${requestId}`,
      payoutTransactionFound: false
    });
  }

  const trx = await db.transaction();
  try {
    const lockedTx = await PayoutTransaction.findByPk(payoutTransaction.id, {
      transaction: trx,
      lock: trx.LOCK.UPDATE
    });

    if (!lockedTx) {
      await trx.rollback();
      return res.status(500).json({ success: false, message: 'Failed to lock transaction' });
    }

    const previousStatus = lockedTx.status;
    const newStatus = normalizedStatus;

    let parsedData = {};
    try {
      parsedData = lockedTx.data ? JSON.parse(lockedTx.data) : {};
    } catch (_) {
      parsedData = { original: lockedTx.data };
    }

    parsedData.callback = payload;

    await lockedTx.update({
      status: newStatus,
      callback_status: newStatus,
      callback_data: JSON.stringify(payload),
      callback_received_at: new Date(),
      data: JSON.stringify(parsedData)
    }, { transaction: trx });

    // CRITICAL: Even if the callback status is FAILED, we DO NOT perform any automatic refund!
    if (previousStatus !== newStatus) {
      await PayoutAuditLog.create({
        payout_id: lockedTx.id,
        action: 'MX_CALLBACK_STATUS_UPDATE',
        details: {
          reference_id: lockedTx.reference_id,
          from: previousStatus,
          to: newStatus,
          callbackPayload: payload
        }
      }, { transaction: trx });
    }

    await trx.commit();

    return res.json({
      success: true,
      message: 'Callback processed successfully',
      payoutTransactionId: lockedTx.id,
      previousStatus,
      newStatus
    });

  } catch (error) {
    await trx.rollback();
    console.error('MX Webhook error:', error);
    return res.status(500).json({
      success: false,
      message: 'Callback processing failed',
      error: error.message || error
    });
  }
});

module.exports = {
  handleMxCallback
};

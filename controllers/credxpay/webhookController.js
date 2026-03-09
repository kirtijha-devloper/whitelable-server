const express = require('express');
const asyncHandler = require('express-async-handler');
const db = require('../../config/database');
const PayoutWebhookLog = require('../../models/PayoutWebhookLog');
const PayoutRequest = require('../../models/PayoutRequest');
const PayoutAuditLog = require('../../models/PayoutAuditLog');
const ledgerService = require('../../services/ledgerService');
const ipAllowlist = require('../../middleware/ipAllowlist');

const router = express.Router();

// protect with IP allowlist middleware
router.post('/', ipAllowlist, asyncHandler(async (req, res) => {
  const payload = req.body;
  const sourceIp = req.ip || req.connection.remoteAddress;
  // persist raw payload
  await PayoutWebhookLog.create({ payload, source_ip: sourceIp });

  const { requestId, status, utr, apiTxnId, opRefId, message } = payload;
  const tr = await db.transaction();
  try {
    const payout = await PayoutRequest.findOne({
      where: { request_id: requestId },
      transaction: tr,
      lock: tr.LOCK.UPDATE
    });
    if (!payout) {
      await tr.commit();
      return res.status(200).json({ acknowledged: true });
    }

    // already terminal?
    const terminal = ['SUCCESS', 'FAILED', 'REVERSED'];
    if (terminal.includes(payout.response_status)) {
      await tr.commit();
      return res.status(200).json({ acknowledged: true });
    }

    // update fields
    payout.response_status = status || payout.response_status;
    if (utr) payout.utr = utr;
    if (apiTxnId) payout.api_txn_id = apiTxnId;
    if (opRefId) payout.op_ref_id = opRefId;
    if (message) payout.response_message = message;

    // audit status change
    await PayoutAuditLog.create({
      payout_id: payout.id,
      action: 'WEBHOOK_UPDATE',
      details: { status, utr, apiTxnId, opRefId, message }
    }, { transaction: tr });

    // if failure and not refunded, credit back
    if (status === 'FAILED' && !payout.refunded) {
      const refundAmount = parseFloat(payout.amount || 0) + parseFloat(payout.charge || 0);
      await ledgerService.createLedgerEntry({
        userId: payout.user_id,
        transactionType: 'payout_refund',
        description: `Refund for failed CredXPay payout ${payout.request_id}`,
        credit: refundAmount
      }, { transaction: tr });
      payout.refunded = true;
    }

    await payout.save({ transaction: tr });
    await tr.commit();
    res.status(200).json({ acknowledged: true });
  } catch (err) {
    await tr.rollback();
    console.error('Webhook processing error:', err);
    // respond 200 so provider retries later
    res.status(200).json({ acknowledged: false });
  }
}));

module.exports = router;
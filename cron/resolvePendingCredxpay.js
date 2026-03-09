const cron = require('node-cron');
const { Op } = require('sequelize');
const PayoutRequest = require('../models/PayoutRequest');
const credxpayService = require('../services/credxpayService');
const db = require('../config/database');
const ledgerService = require('../services/ledgerService');

async function resolvePending() {
  console.log('[cron] resolvePendingCredxpay started');
  const cutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

  const pending = await PayoutRequest.findAll({
    where: {
      response_status: 'PENDING',
      created_at: { [Op.lt]: cutoff }
    }
  });

  for (const p of pending) {
    try {
      const statusResp = await credxpayService.checkStatus(p.request_id);
      // mimic webhook logic inside transaction
      const tr = await db.transaction();
      try {
        const locked = await PayoutRequest.findByPk(p.id, { transaction: tr, lock: tr.LOCK.UPDATE });
        if (!locked) {
          await tr.commit();
          continue;
        }
        if (['SUCCESS', 'FAILED', 'REVERSED'].includes(locked.response_status)) {
          await tr.commit();
          continue;
        }
        locked.response_status = statusResp.status || locked.response_status;
        if (statusResp.utr) locked.utr = statusResp.utr;
        if (statusResp.apiTxnId) locked.api_txn_id = statusResp.apiTxnId;
        if (statusResp.opRefId) locked.op_ref_id = statusResp.opRefId;
        if (statusResp.message) locked.response_message = statusResp.message;

        if (locked.response_status === 'FAILED' && !locked.refunded) {
          const refundAmount = parseFloat(locked.amount || 0) + parseFloat(locked.charge || 0);
          await ledgerService.createLedgerEntry({
            userId: locked.user_id,
            transactionType: 'payout_refund',
            description: `Refund for failed CredXPay payout ${locked.request_id}`,
            credit: refundAmount
          }, { transaction: tr });
          locked.refunded = true;
        }

        await locked.save({ transaction: tr });
        await tr.commit();
        console.log(`[cron] resolved request ${locked.request_id} to ${locked.response_status}`);
      } catch (err) {
        await tr.rollback();
        console.error('cron transaction error', err);
      }
    } catch (err) {
      console.error('status check failed for', p.request_id, err);
    }
  }
}

// schedule every five minutes
cron.schedule('*/5 * * * *', () => {
  resolvePending().catch((err) => console.error('resolvePending error', err));
});

module.exports = { resolvePending };
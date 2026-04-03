const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { Op } = require('sequelize');
const PayoutTransaction = require('../models/PayoutTransaction');
const branchxService = require('../services/payments/branchxService');
const db = require('../config/database');
const ledgerService = require('../services/ledgerService');
const User = require('../models/User');
const Ledger = require('../models/Ledger');

const LOG_FILE = path.resolve(__dirname, '../logs/branchx-payout-cron.log');
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

function appendLog(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  fs.appendFile(LOG_FILE, line, (err) => { if (err) console.error('Failed to write cron log', err); });
}

async function resolvePending() {
  console.log('[cron] resolvePendingBranchx started');
  appendLog('resolvePendingBranchx started');
  const cutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

  const pendingTxns = await PayoutTransaction.findAll({
    where: {
      status: 'PENDING',
      createdAt: { [Op.lt]: cutoff }
    }
  });

  for (const tx of pendingTxns) {
    if (!tx.reference_id) {
      const msg = `[cron] skipping payoutTxn ${tx.id}: missing reference_id`;
      console.warn(msg);
      appendLog(msg);
      continue;
    }

    try {
      const response = await branchxService.statusCheck(tx.reference_id);
      const transactionStatus = response?.data?.status || response?.status || 'PENDING';

      if (transactionStatus === tx.status) {
        // update data payload for audit (in case BranchX returned new details)
        await tx.update({ data: JSON.stringify(response) });
        continue;
      }

      const tr = await db.transaction();
      try {
        const locked = await PayoutTransaction.findByPk(tx.id, { transaction: tr, lock: tr.LOCK.UPDATE });
        if (!locked) {
          await tr.commit();
          continue;
        }

        // If status already transitioned by another process, skip
        if (['SUCCESS', 'FAILED', 'REVERSED'].includes(locked.status) && locked.status !== transactionStatus) {
          locked.status = transactionStatus;
        } else {
          locked.status = transactionStatus;
        }

        locked.data = JSON.stringify(response);

        if ((tx.status === 'SUCCESS' || tx.status === 'PENDING') && transactionStatus === 'FAILED') {
          const refundAmount = parseFloat(locked.amount || 0) + parseFloat(locked.service_charge || 0);

          if (refundAmount > 0) {
            await ledgerService.createLedgerEntry({
              userId: locked.merchant_id,
              transactionType: 'payout_refund',
              referenceId: locked.id,
              referenceTable: 'PayoutTransactions',
              description: `BranchX payout failed: refund ₹${refundAmount} for payout ${locked.reference_id}`,
              credit: refundAmount,
              status: 'completed',
              metadata: {
                payout_reference: locked.reference_id,
                branchx_status: transactionStatus,
                original_payout_amount: locked.amount,
                original_service_charge: locked.service_charge
              }
            }, { transaction: tr });
          }

          await Ledger.update(
            { status: 'failed' },
            {
              where: {
                reference_id: locked.id,
                reference_table: 'PayoutTransactions',
                status: 'pending'
              },
              transaction: tr
            }
          );
        }

        await locked.save({ transaction: tr });
        await tr.commit();
        const msg = `[cron] resolved BranchX payout ${locked.reference_id} -> ${transactionStatus}`;
        console.log(msg);
        appendLog(msg);
      } catch (err) {
        await tr.rollback();
        const msg = `[cron] transaction failed for payout ${tx.id} ${err.message || err}`;
        console.error(msg, err);
        appendLog(msg);
      }
    } catch (err) {
      const msg = `[cron] status check failed for payout ${tx.id} (${tx.reference_id}) ${err.message || err}`;
      console.error(msg, err);
      appendLog(msg);
    }
  }
}

cron.schedule('*/5 * * * *', () => {
  resolvePending().catch((err) => {
    const msg = `resolvePendingBranchx error ${err.message || err}`;
    console.error(msg, err);
    appendLog(msg);
  });
});

module.exports = { resolvePending };
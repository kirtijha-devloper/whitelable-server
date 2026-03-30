const cron = require('node-cron');
const { Op } = require('sequelize');
const PayoutTransaction = require('../models/PayoutTransaction');
const branchxService = require('../services/payments/branchxService');
const db = require('../config/database');
const ledgerService = require('../services/ledgerService');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');

async function resolvePending() {
  console.log('[cron] resolvePendingBranchx started');
  const cutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

  const pendingTxns = await PayoutTransaction.findAll({
    where: {
      status: 'PENDING',
      createdAt: { [Op.lt]: cutoff }
    }
  });

  for (const tx of pendingTxns) {
    if (!tx.reference_id) {
      console.warn(`[cron] skipping payoutTxn ${tx.id}: missing reference_id`);
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
          const user = await User.findByPk(locked.merchant_id, { transaction: tr });
          if (user) {
            user.wallet = parseFloat(user.wallet || 0) + parseFloat(locked.amount || 0);
            await user.save({ transaction: tr });

            const walletTx = await WalletTransaction.findOne({
              where: {
                source: 'branchx',
                reference_id: locked.reference_id
              },
              order: [['createdAt', 'DESC']],
              transaction: tr
            });

            if (walletTx) {
              walletTx.status = 'failed';
              walletTx.reason = `BranchX payout failed: ${response?.data?.message || response?.message || 'Transaction failed'}`;
              await walletTx.save({ transaction: tr });
            }
          }
        }

        await locked.save({ transaction: tr });
        await tr.commit();
        console.log(`[cron] resolved BranchX payout ${locked.reference_id} -> ${transactionStatus}`);
      } catch (err) {
        await tr.rollback();
        console.error(`[cron] transaction failed for payout ${tx.id}`, err);
      }
    } catch (err) {
      console.error(`[cron] status check failed for payout ${tx.id} (${tx.reference_id})`, err);
    }
  }
}

cron.schedule('*/5 * * * *', () => {
  resolvePending().catch((err) => console.error('resolvePendingBranchx error', err));
});

module.exports = { resolvePending };
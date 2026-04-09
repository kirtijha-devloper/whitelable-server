const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { Op } = require('sequelize');
const PayoutTransaction = require('../models/PayoutTransaction');
const Ledger = require('../models/Ledger');
const branchxService = require('../services/payments/branchxService');
const db = require('../config/database');
const ledgerService = require('../services/ledgerService');

const LOG_FILE = path.resolve(__dirname, '../logs/branchx-payout-cron.log');
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

const ONE_MINUTE_MS = 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ENABLE_BRANCHX_PENDING_CRON = process.env.ENABLE_BRANCHX_PENDING_CRON !== 'false';
let resolvePendingInFlight = false;

function appendLog(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  fs.appendFile(LOG_FILE, line, (err) => { if (err) console.error('Failed to write cron log', err); });
}

function normalizeBranchxStatus(statusRaw) {
  if (!statusRaw) return 'PENDING';
  const s = statusRaw.toString().trim().toUpperCase();
  if (['SUCCESS', 'COMPLETED'].includes(s)) return 'SUCCESS';
  if (['FAILED', 'FAILURE', 'REJECTED', 'CANCELLED', 'REVERSED'].includes(s)) return 'FAILED';
  if (['PENDING', 'PROCESSING', 'IN_PROGRESS'].includes(s)) return 'PENDING';
  return 'PENDING';
}

function toTimestamp(value) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function shouldPollBranchxPayout(tx, now = Date.now()) {
  const createdAtMs = toTimestamp(tx.createdAt);
  if (!createdAtMs) return false;

  // Never poll brand-new rows. The first refresh happens only after 1 minute.
  if (now - createdAtMs < ONE_MINUTE_MS) return false;

  const updatedAtMs = toTimestamp(tx.updatedAt || tx.createdAt);

  // If the row has never been refreshed yet, poll it once after the 1-minute mark.
  if (updatedAtMs <= createdAtMs) return true;

  // Once refreshed, wait 5 minutes between follow-up checks while still pending.
  return now - updatedAtMs >= FIVE_MINUTES_MS;
}

function getBranchxPollDebug(tx, now = Date.now()) {
  const createdAtMs = toTimestamp(tx.createdAt);
  const updatedAtMs = toTimestamp(tx.updatedAt || tx.createdAt);
  return {
    ageMinutes: createdAtMs ? Number(((now - createdAtMs) / ONE_MINUTE_MS).toFixed(2)) : null,
    sinceUpdatedMinutes: updatedAtMs ? Number(((now - updatedAtMs) / ONE_MINUTE_MS).toFixed(2)) : null,
  };
}

function getBranchxPollSkipReason(tx, now = Date.now()) {
  const createdAtMs = toTimestamp(tx.createdAt);
  if (!createdAtMs) return 'missing createdAt';
  if (now - createdAtMs < ONE_MINUTE_MS) return 'too new for first poll';

  const updatedAtMs = toTimestamp(tx.updatedAt || tx.createdAt);
  if (updatedAtMs > createdAtMs && now - updatedAtMs < FIVE_MINUTES_MS) {
    return 'waiting 5-minute retry window';
  }

  return 'not eligible';
}

function getBranchxResponseSummary(response) {
  const topLevel = response || {};
  const nested = topLevel?.data || {};
  const nestedData = nested?.data || {};
  return {
    topLevelStatus: topLevel?.status ?? null,
    topLevelMessage: topLevel?.message ?? null,
    nestedStatus: nested?.status ?? null,
    nestedMessage: nested?.message ?? null,
    nestedDataStatus: nestedData?.status ?? null,
    nestedDataMessage: nestedData?.message ?? null,
    requestId: topLevel?.requestId ?? nested?.requestId ?? nestedData?.requestId ?? null,
  };
}

async function resolvePending() {
  if (resolvePendingInFlight) {
    const msg = '[cron] resolvePendingBranchx skipped: previous run still in progress';
    console.log(msg);
    appendLog(msg);
    return;
  }

  resolvePendingInFlight = true;
  console.log('[cron] resolvePendingBranchx started');
  appendLog('resolvePendingBranchx started');

  try {
    const initialCutoff = new Date(Date.now() - ONE_MINUTE_MS);

    const pendingTxns = await PayoutTransaction.findAll({
      where: {
        status: 'PENDING',
        createdAt: { [Op.lt]: initialCutoff }
      },
      order: [['updatedAt', 'ASC'], ['createdAt', 'ASC']]
    });

    const scanMsg = `[cron] BranchX pending scan: found ${pendingTxns.length} row(s) older than 1 minute`;
    console.log(scanMsg);
    appendLog(scanMsg);

    for (const [index, tx] of pendingTxns.entries()) {
      const sequenceLabel = `${index + 1}/${pendingTxns.length}`;
      if (!tx.reference_id) {
        const msg = `[cron] skipping payoutTxn ${tx.id} (${sequenceLabel}): missing reference_id`;
        console.warn(msg);
        appendLog(msg);
        continue;
      }

      try {
        const debug = getBranchxPollDebug(tx);
        const candidateMsg = `[cron] BranchX candidate ${sequenceLabel} payoutTxn=${tx.id} ref=${tx.reference_id} status=${tx.status} ageMinutes=${debug.ageMinutes} updatedAgoMinutes=${debug.sinceUpdatedMinutes}`;
        console.log(candidateMsg);
        appendLog(candidateMsg);

        if (!shouldPollBranchxPayout(tx)) {
          const skipMsg = `[cron] BranchX skip ${sequenceLabel} payoutTxn=${tx.id} ref=${tx.reference_id}: ${getBranchxPollSkipReason(tx)}`;
          console.log(skipMsg);
          appendLog(skipMsg);
          continue;
        }

        const statusCheckStartMsg = `[cron] BranchX status check start ${sequenceLabel} payoutTxn=${tx.id} ref=${tx.reference_id}`;
        console.log(statusCheckStartMsg);
        appendLog(statusCheckStartMsg);

        const response = await branchxService.statusCheck(tx.reference_id);
        const rawStatus = response?.data?.status || response?.status || 'PENDING';
        const transactionStatus = normalizeBranchxStatus(rawStatus);
        const responseSummary = getBranchxResponseSummary(response);
        const responseMsg = `[cron] BranchX response ${sequenceLabel} payoutTxn=${tx.id} ref=${tx.reference_id} rawStatus=${JSON.stringify(rawStatus)} normalizedStatus=${transactionStatus} summary=${JSON.stringify(responseSummary)}`;
        console.log(responseMsg);
        appendLog(responseMsg);

        const tr = await db.transaction();
        try {
          const locked = await PayoutTransaction.findByPk(tx.id, { transaction: tr, lock: tr.LOCK.UPDATE });
          if (!locked) {
            await tr.commit();
            continue;
          }

          // If status already transitioned by another process, skip.
          if (['SUCCESS', 'FAILED', 'REVERSED'].includes(locked.status)) {
            await tr.commit();
            continue;
          }

          const previousStatus = locked.status;
          locked.data = JSON.stringify(response);

          if (transactionStatus === 'PENDING') {
            await locked.save({ transaction: tr });
            await tr.commit();
            const msg = `[cron] refreshed BranchX payout ${locked.reference_id} (${sequenceLabel}) -> ${transactionStatus}`;
            console.log(msg);
            appendLog(msg);
            const retryMsg = `[cron] BranchX payout ${locked.reference_id} (${sequenceLabel}) still pending; next retry window after 5 minutes from the last refresh`;
            console.log(retryMsg);
            appendLog(retryMsg);
            continue;
          }

          locked.status = transactionStatus;

          if ((previousStatus === 'SUCCESS' || previousStatus === 'PENDING') && transactionStatus === 'FAILED') {
            const refundAmount = parseFloat(locked.amount || 0) + parseFloat(locked.service_charge || 0);

            if (refundAmount > 0) {
              const existingRefund = await Ledger.findOne({
                where: {
                  transaction_type: 'payout_refund',
                  reference_id: locked.id,
                  reference_table: 'PayoutTransactions'
                },
                transaction: tr
              });

              if (existingRefund) {
                await locked.save({ transaction: tr });
                await tr.commit();
                const msg = `[cron] payout ${locked.reference_id} (${sequenceLabel}) failed but refund already exists`;
                console.log(msg);
                appendLog(msg);
                continue;
              }

              await ledgerService.createLedgerEntry({
                userId: locked.merchant_id,
                transactionType: 'payout_refund',
                referenceId: locked.id,
                referenceTable: 'PayoutTransactions',
                description: `BranchX payout failed: refund ₹${refundAmount} for payout ${locked.reference_id}`,
                credit: refundAmount,
                metadata: {
                  payout_reference: locked.reference_id,
                  branchx_status: transactionStatus,
                  original_payout_amount: locked.amount,
                  original_service_charge: locked.service_charge
                }
              }, { transaction: tr });
            }
          }

          await locked.save({ transaction: tr });
          await tr.commit();
          const msg = `[cron] resolved BranchX payout ${locked.reference_id} (${sequenceLabel}) -> ${transactionStatus}`;
          console.log(msg);
          appendLog(msg);
        } catch (err) {
          await tr.rollback();
          const msg = `[cron] transaction failed for payout ${tx.id} (${sequenceLabel}) ${err.message || err}`;
          console.error(msg, err);
          appendLog(msg);
        }
      } catch (err) {
        const msg = `[cron] status check failed for payout ${tx.id} (${sequenceLabel}) (${tx.reference_id}) ${err.message || err}`;
        console.error(msg, err);
        appendLog(msg);
      }
    }
  } finally {
    resolvePendingInFlight = false;
  }
}

if (ENABLE_BRANCHX_PENDING_CRON) {
  cron.schedule('*/30 * * * * *', () => {
    resolvePending().catch((err) => {
      const msg = `resolvePendingBranchx error ${err.message || err}`;
      console.error(msg, err);
      appendLog(msg);
    });
  });
} else {
  const msg = '[cron] BranchX pending resolver is disabled. Set ENABLE_BRANCHX_PENDING_CRON=true to enable it.';
  console.log(msg);
  appendLog(msg);
}

module.exports = { resolvePending };

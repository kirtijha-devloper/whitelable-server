/**
 * =========================================================================
 * NDIA5 PENDING PAYOUT RESOLVER CRON
 * =========================================================================
 * Periodically polls the NDIA5 Payout Status API for PENDING transactions.
 * Configured schedule: Every 3 minutes (`0 */3 * * * *`).
 * 
 * NOTE: Does NOT issue automatic refunds when a payout moves to FAILED.
 * Refunds must be executed manually by authorized personnel.
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { Op } = require('sequelize');
const PayoutTransaction = require('../models/PayoutTransaction');
const PayoutAuditLog = require('../models/PayoutAuditLog');
const db = require('../config/database');
const ndia5Service = require('../services/ndia5Payout.service');

const CRON_LOG_FILE = path.resolve(__dirname, '../logs/india5-payout-cron.log');
if (!fs.existsSync(path.dirname(CRON_LOG_FILE))) {
  fs.mkdirSync(path.dirname(CRON_LOG_FILE), { recursive: true });
}

const THREE_MINUTES_MS = 3 * 60 * 1000;
const ENABLE_NDIA5_PENDING_CRON = process.env.ENABLE_NDIA5_PENDING_CRON !== 'false';
const NDIA5_PENDING_CRON_SCHEDULE = process.env.NDIA5_PENDING_CRON_SCHEDULE || '0 */3 * * * *';

let resolvePendingInFlight = false;

function appendCronLog(message) {
  try {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${message}\n`;
    fs.appendFileSync(CRON_LOG_FILE, line);
  } catch (_) { /* prevent logging failure crashes */ }
}

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
 * Main cron function scanning for NDIA5 pending payout transactions
 */
async function resolvePendingNdia5() {
  if (resolvePendingInFlight) {
    const msg = '[cron] resolvePendingNdia5 skipped: previous execution still in progress';
    console.log(msg);
    appendCronLog(msg);
    return;
  }

  resolvePendingInFlight = true;
  console.log('[cron] resolvePendingNdia5 started (3-minute interval)');
  appendCronLog('resolvePendingNdia5 started');

  try {
    // Cutoff time: transactions older than 3 minutes
    const cutoffTime = new Date(Date.now() - THREE_MINUTES_MS);

    const pendingTxns = await PayoutTransaction.findAll({
      where: {
        status: 'PENDING',
        payout_provider: 'Ndia5',
        createdAt: { [Op.lt]: cutoffTime },
      },
      order: [['createdAt', 'ASC']],
    });

    const scanMsg = `[cron] NDIA5 pending scan found ${pendingTxns.length} row(s) older than 3 minutes`;
    console.log(scanMsg);
    appendCronLog(scanMsg);

    for (const [index, tx] of pendingTxns.entries()) {
      const label = `${index + 1}/${pendingTxns.length}`;
      if (!tx.reference_id) {
        const msg = `[cron] NDIA5 skipping transaction ${tx.id} (${label}): missing reference_id`;
        console.warn(msg);
        appendCronLog(msg);
        continue;
      }

      try {
        appendCronLog(`[cron] Checking status for NDIA5 payoutTxn=${tx.id} ref=${tx.reference_id}`);

        // Call service (automatically writes full request & response into logs/india5.log)
        const providerResult = await ndia5Service.getPayoutStatus(tx.reference_id);

        const tr = await db.transaction();
        try {
          const locked = await PayoutTransaction.findByPk(tx.id, { transaction: tr, lock: tr.LOCK.UPDATE });
          if (!locked || ['SUCCESS', 'FAILED', 'REVERSED', 'CANCELLED'].includes(locked.status)) {
            await tr.commit();
            continue;
          }

          const previousStatus = locked.status;
          const existingData = parseJsonMaybe(locked.data);

          const mergedData = {
            ...existingData,
            provider: 'Ndia5',
            latestCronCheck: providerResult.rawResponse,
            lastCronCheckAt: new Date().toISOString(),
          };

          locked.status = providerResult.status;
          locked.service_charge = providerResult.serviceCharge ?? locked.service_charge ?? 0;
          locked.data = JSON.stringify(mergedData);

          await locked.save({ transaction: tr });

          // Write audit log entry on terminal status update
          if (['SUCCESS', 'FAILED'].includes(providerResult.status)) {
            await PayoutAuditLog.create({
              payout_id: locked.id,
              action: 'NDIA5_CRON_RESOLVED',
              details: {
                reference_id: locked.reference_id,
                from: previousStatus,
                to: providerResult.status,
                rawResponse: providerResult.rawResponse,
                resolvedByCron: true,
                autoRefund: false, // Explicit: No auto-refund executed
                refundNotice: providerResult.status === 'FAILED' ? 'Payout failed. Refund must be triggered manually.' : undefined,
              },
            }, { transaction: tr });
          }

          await tr.commit();

          const resMsg = `[cron] NDIA5 payout ${locked.reference_id} status updated -> ${providerResult.status}`;
          console.log(resMsg);
          appendCronLog(resMsg);
        } catch (dbErr) {
          await tr.rollback();
          const errLog = `[cron] Database update failed for NDIA5 payout ${tx.id}: ${dbErr.message}`;
          console.error(errLog, dbErr);
          appendCronLog(errLog);
        }
      } catch (apiErr) {
        const errLog = `[cron] Status check API failed for NDIA5 payout ${tx.id} (${tx.reference_id}): ${apiErr.message}`;
        console.error(errLog, apiErr);
        appendCronLog(errLog);
      }
    }
  } finally {
    resolvePendingInFlight = false;
  }
}

// Schedule cron job if enabled
if (ENABLE_NDIA5_PENDING_CRON) {
  cron.schedule(NDIA5_PENDING_CRON_SCHEDULE, () => {
    resolvePendingNdia5().catch((err) => {
      const msg = `resolvePendingNdia5 uncaught error: ${err.message || err}`;
      console.error(msg, err);
      appendCronLog(msg);
    });
  });
  console.log(`[cron] NDIA5 pending resolver cron initialized with schedule: ${NDIA5_PENDING_CRON_SCHEDULE}`);
} else {
  console.log('[cron] NDIA5 pending resolver cron is disabled via ENABLE_NDIA5_PENDING_CRON=false');
}

module.exports = { resolvePendingNdia5 };

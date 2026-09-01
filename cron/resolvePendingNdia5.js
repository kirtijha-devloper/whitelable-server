/**
 * =========================================================================
 * NDIA5 PENDING PAYOUT RESOLVER CRON
 * =========================================================================
 * Periodically polls the NDIA5 Payout Status API for PENDING transactions.
 * Configured schedule: Every 3 minutes (0 every 3 mins).
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
const ledgerService = require('../services/ledgerService');

const CRON_LOG_FILE = path.resolve(__dirname, '../logs/india5-payout-cron.log');
try {
  const logDir = path.dirname(CRON_LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (_) { /* prevent permission failure crashes */ }

const THREE_MINUTES_MS = 3 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
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

          let cronAutoRefundCompleted = false;
          let cronRefundEntry = null;

          if (providerResult.status === 'FAILED') {
            const amount = Number(locked.amount) || 0;
            const serviceCharge = Number(locked.service_charge) || 0;
            const refundAmount = amount + serviceCharge;

            const Ledger = require('../models/Ledger');
            const existingRefund = await Ledger.findOne({
              where: {
                transaction_type: 'payout_refund',
                reference_id: locked.id,
                reference_table: 'PayoutTransactions',
              },
              transaction: tr,
            });

            if (!existingRefund && refundAmount > 0) {
              try {
                cronRefundEntry = await ledgerService.createLedgerEntry({
                  userId: locked.merchant_id,
                  transactionType: 'payout_refund',
                  referenceId: locked.id,
                  referenceTable: 'PayoutTransactions',
                  description: `Auto Refund for failed NDIA5 Payout ${locked.reference_id}`,
                  credit: refundAmount,
                  metadata: {
                    payout_provider: 'Ndia5',
                    payout_reference: locked.reference_id,
                    original_payout_amount: String(amount),
                    original_service_charge: String(serviceCharge),
                    refund_source: 'cron_status_auto',
                  },
                }, { transaction: tr });

                existingData.autoRefundProcessed = true;
                existingData.autoRefundAt = new Date().toISOString();
                existingData.refundLedgerId = cronRefundEntry?.id || null;
                cronAutoRefundCompleted = true;
              } catch (refundErr) {
                console.error('[NDIA5 Cron Status Auto Refund Error]:', refundErr);
              }
            }
          }

          const mergedData = {
            ...existingData,
            provider: 'Ndia5',
            latestCronCheck: providerResult.rawResponse,
            lastCronCheckAt: new Date().toISOString(),
          };

          locked.status = providerResult.status;
          locked.service_charge = locked.service_charge ?? providerResult.serviceCharge ?? 0;
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
                autoRefund: cronAutoRefundCompleted,
                refundNotice: providerResult.status === 'FAILED' 
                  ? (cronAutoRefundCompleted ? 'Payout failed. Auto-refund issued to merchant wallet.' : 'Payout failed. Refund must be triggered manually.') 
                  : undefined,
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

        // ----------------------------------------------------------------
        // Auto-fail guard: mark as FAILED (no auto-refund) if either:
        //   1. Status check returned HTTP 400 (NDIA5 does not recognise the
        //      reference — typically because initiation timed out before
        //      NDIA5 could register it), OR
        //   2. The initiation itself previously failed with a timeout and
        //      left the transaction in PENDING state
        // …and the transaction is already older than 30 minutes.
        //
        // Refund is intentionally NOT issued here — admin must do it
        // manually, consistent with existing NDIA5 refund policy.
        // ----------------------------------------------------------------
        try {
          const txAgeMs = Date.now() - new Date(tx.createdAt).getTime();
          const isOlderThan30Min = txAgeMs > THIRTY_MINUTES_MS;

          const is400StatusCheck = apiErr.message.includes('status code 400');
          const txData = parseJsonMaybe(tx.data);
          const hasInitiationTimeout =
            !!(txData.initiationError && /timeout/i.test(txData.initiationError));

          if (isOlderThan30Min && (is400StatusCheck || hasInitiationTimeout)) {
            const autoFailReason = is400StatusCheck
              ? 'status_check_returned_400'
              : 'initiation_timeout_detected';

            const tr2 = await db.transaction();
            try {
              const locked2 = await PayoutTransaction.findByPk(tx.id, {
                transaction: tr2,
                lock: tr2.LOCK.UPDATE,
              });

              if (locked2 && !['SUCCESS', 'FAILED', 'REVERSED', 'CANCELLED'].includes(locked2.status)) {
                const existingData2 = parseJsonMaybe(locked2.data);
                locked2.status = 'FAILED';
                locked2.data = JSON.stringify({
                  ...existingData2,
                  cronAutoFailedReason: autoFailReason,
                  cronAutoFailedAt: new Date().toISOString(),
                  cronAutoFailApiError: apiErr.message,
                  txAgeMinutesAtFail: Math.floor(txAgeMs / 60000),
                });
                await locked2.save({ transaction: tr2 });

                await PayoutAuditLog.create({
                  payout_id: locked2.id,
                  action: 'NDIA5_CRON_AUTO_FAILED',
                  details: {
                    reference_id: locked2.reference_id,
                    from: 'PENDING',
                    to: 'FAILED',
                    reason: is400StatusCheck
                      ? 'Status check returned HTTP 400 — reference not found on NDIA5 (payout was never registered).'
                      : 'Initiation previously timed out; payout was never submitted to NDIA5.',
                    apiError: apiErr.message,
                    txAgeMinutes: Math.floor(txAgeMs / 60000),
                    autoRefund: false,
                    refundNotice: 'Payout auto-failed by cron after 30-minute threshold. Refund must be triggered manually by admin.',
                  },
                }, { transaction: tr2 });

                const failMsg = `[cron] NDIA5 payout ${locked2.reference_id} auto-marked FAILED (reason=${autoFailReason}, age=${Math.floor(txAgeMs / 60000)}min)`;
                console.log(failMsg);
                appendCronLog(failMsg);
              }

              await tr2.commit();
            } catch (autoFailDbErr) {
              await tr2.rollback();
              const autoFailErrLog = `[cron] Auto-fail DB update failed for NDIA5 payout ${tx.id}: ${autoFailDbErr.message}`;
              console.error(autoFailErrLog, autoFailDbErr);
              appendCronLog(autoFailErrLog);
            }
          }
        } catch (autoFailErr) {
          // Never crash the main cron loop due to auto-fail logic
          const guardErrLog = `[cron] Auto-fail guard threw for NDIA5 payout ${tx.id}: ${autoFailErr.message}`;
          console.error(guardErrLog, autoFailErr);
          appendCronLog(guardErrLog);
        }
      }
    }
  } finally {
    resolvePendingInFlight = false;
  }
}

// Schedule cron job if enabled
try {
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
} catch (cronErr) {
  console.error('[cron] NDIA5 cron schedule initialization failed:', cronErr.message || cronErr);
}


module.exports = { resolvePendingNdia5 };

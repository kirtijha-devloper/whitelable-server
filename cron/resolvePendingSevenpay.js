const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { Op } = require('sequelize');
const PayoutTransaction = require('../models/PayoutTransaction');
const Ledger = require('../models/Ledger');
const PayoutAuditLog = require('../models/PayoutAuditLog');
const db = require('../config/database');
const sevenpayService = require('../services/sevenpayPayout.service');
const ledgerService = require('../services/ledgerService');

const LOG_FILE = path.resolve(__dirname, '../logs/sevenpay-payout-cron.log');
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

const ONE_MINUTE_MS = 60 * 1000;
const THREE_MINUTES_MS = 3 * ONE_MINUTE_MS;
const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS;
const ENABLE_SEVENPAY_PENDING_CRON = process.env.ENABLE_SEVENPAY_PENDING_CRON !== 'false';
const SEVENPAY_PENDING_CRON_SCHEDULE = process.env.SEVENPAY_PENDING_CRON_SCHEDULE || '0 */2 * * * *';
let resolvePendingInFlight = false;

function appendLog(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  fs.appendFile(LOG_FILE, line, (err) => {
    if (err) console.error('Failed to write SevenPay cron log', err);
  });
}

function parseJsonMaybe(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return {};
  }
}

function toTimestamp(value) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function shouldPollSevenpayPayout(tx, now = Date.now()) {
  const createdAtMs = toTimestamp(tx.createdAt);
  if (!createdAtMs) return false;
  if (now - createdAtMs < THREE_MINUTES_MS) return false;

  const updatedAtMs = toTimestamp(tx.updatedAt || tx.createdAt);
  if (updatedAtMs <= createdAtMs) return true;

  return now - updatedAtMs >= FIVE_MINUTES_MS;
}

function getPollDebug(tx, now = Date.now()) {
  const createdAtMs = toTimestamp(tx.createdAt);
  const updatedAtMs = toTimestamp(tx.updatedAt || tx.createdAt);
  return {
    ageMinutes: createdAtMs ? Number(((now - createdAtMs) / ONE_MINUTE_MS).toFixed(2)) : null,
    sinceUpdatedMinutes: updatedAtMs ? Number(((now - updatedAtMs) / ONE_MINUTE_MS).toFixed(2)) : null,
  };
}

function getPollSkipReason(tx, now = Date.now()) {
  const createdAtMs = toTimestamp(tx.createdAt);
  if (!createdAtMs) return 'missing createdAt';
  if (now - createdAtMs < THREE_MINUTES_MS) return 'too new for first poll';

  const updatedAtMs = toTimestamp(tx.updatedAt || tx.createdAt);
  if (updatedAtMs > createdAtMs && now - updatedAtMs < FIVE_MINUTES_MS) {
    return 'waiting 5-minute retry window';
  }

  return 'not eligible';
}

function buildProviderSnapshot(existingTransaction, normalizedResponse) {
  const previous = parseJsonMaybe(existingTransaction?.data);
  return {
    ...previous,
    provider: 'Sevenpay',
    latest: normalizedResponse.rawResponse,
    normalized: {
      crn: normalizedResponse.crn,
      paymentId: normalizedResponse.paymentId,
      status: normalizedResponse.status,
      amount: normalizedResponse.amount,
      serviceCharge: normalizedResponse.serviceCharge,
      bankReferenceNo: normalizedResponse.bankReferenceNo,
    },
  };
}

async function resolvePendingSevenpay() {
  if (resolvePendingInFlight) {
    const msg = '[cron] resolvePendingSevenpay skipped: previous run still in progress';
    console.log(msg);
    appendLog(msg);
    return;
  }

  resolvePendingInFlight = true;
  console.log('[cron] resolvePendingSevenpay started');
  appendLog('resolvePendingSevenpay started');

  try {
    const initialCutoff = new Date(Date.now() - THREE_MINUTES_MS);
    const pendingTxns = await PayoutTransaction.findAll({
      where: {
        status: 'PENDING',
        payout_provider: 'Sevenpay',
        createdAt: { [Op.lt]: initialCutoff },
      },
      order: [['updatedAt', 'ASC'], ['createdAt', 'ASC']],
    });

    const scanMsg = `[cron] SevenPay pending scan: found ${pendingTxns.length} row(s) older than 3 minutes`;
    console.log(scanMsg);
    appendLog(scanMsg);

    for (const [index, tx] of pendingTxns.entries()) {
      const sequenceLabel = `${index + 1}/${pendingTxns.length}`;
      if (!tx.reference_id) {
        const msg = `[cron] SevenPay skipping payoutTxn ${tx.id} (${sequenceLabel}): missing reference_id`;
        console.warn(msg);
        appendLog(msg);
        continue;
      }

      try {
        const debug = getPollDebug(tx);
        const candidateMsg = `[cron] SevenPay candidate ${sequenceLabel} payoutTxn=${tx.id} ref=${tx.reference_id} status=${tx.status} ageMinutes=${debug.ageMinutes} updatedAgoMinutes=${debug.sinceUpdatedMinutes}`;
        console.log(candidateMsg);
        appendLog(candidateMsg);

        if (!shouldPollSevenpayPayout(tx)) {
          const skipMsg = `[cron] SevenPay skip ${sequenceLabel} payoutTxn=${tx.id} ref=${tx.reference_id}: ${getPollSkipReason(tx)}`;
          console.log(skipMsg);
          appendLog(skipMsg);
          continue;
        }

        const parsedData = parseJsonMaybe(tx.data);
        const storedPaymentId = parsedData?.normalized?.paymentId || parsedData?.latest?.paymentId || null;
        const statusCheckStartMsg = `[cron] SevenPay status check start ${sequenceLabel} payoutTxn=${tx.id} ref=${tx.reference_id}`;
        console.log(statusCheckStartMsg);
        appendLog(statusCheckStartMsg);

        const serviceResponse = await sevenpayService.getPayoutStatus({
          crn: tx.reference_id,
          paymentId: storedPaymentId,
        });

        const responseMsg = `[cron] SevenPay response ${sequenceLabel} payoutTxn=${tx.id} ref=${tx.reference_id} normalizedStatus=${serviceResponse.status} paymentId=${serviceResponse.paymentId || storedPaymentId || ''} bankReferenceNo=${serviceResponse.bankReferenceNo || ''} rawResponse=${JSON.stringify(serviceResponse.rawResponse || null)}`;
        console.log(responseMsg);
        appendLog(responseMsg);

        const tr = await db.transaction();
        try {
          const locked = await PayoutTransaction.findByPk(tx.id, { transaction: tr, lock: tr.LOCK.UPDATE });
          if (!locked) {
            await tr.commit();
            continue;
          }

          if (['SUCCESS', 'FAILED', 'REVERSED', 'CANCELLED'].includes(locked.status)) {
            await tr.commit();
            continue;
          }

          const previousStatus = locked.status;
          const mergedData = buildProviderSnapshot(locked, serviceResponse);
          mergedData.lastCronStatusCheck = {
            timestamp: new Date().toISOString(),
            normalizedStatus: serviceResponse.status,
            paymentId: serviceResponse.paymentId || storedPaymentId || null,
            bankReferenceNo: serviceResponse.bankReferenceNo || null,
          };

          locked.status = serviceResponse.status;
          locked.reference_id = serviceResponse.crn || locked.reference_id;
          locked.amount = serviceResponse.amount || locked.amount;
          locked.service_charge = locked.service_charge ?? serviceResponse.serviceCharge ?? 0;

          let refundEntry = null;
          if ((previousStatus === 'SUCCESS' || previousStatus === 'PENDING') && serviceResponse.status === 'FAILED') {
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
                locked.data = JSON.stringify(mergedData);
                await locked.save({ transaction: tr });
                await tr.commit();
                const msg = `[cron] SevenPay payout ${locked.reference_id} (${sequenceLabel}) failed but refund already exists`;
                console.log(msg);
                appendLog(msg);
                continue;
              }

              refundEntry = await ledgerService.createLedgerEntry({
                userId: locked.merchant_id,
                transactionType: 'payout_refund',
                referenceId: locked.id,
                referenceTable: 'PayoutTransactions',
                description: `SevenPay payout failed: refund ₹${refundAmount} for payout ${locked.reference_id}`,
                credit: refundAmount,
                metadata: {
                  payout_provider: 'Sevenpay',
                  payout_reference: locked.reference_id,
                  sevenpay_status: serviceResponse.status,
                  original_payout_amount: locked.amount,
                  original_service_charge: locked.service_charge
                }
              }, { transaction: tr });

              mergedData.manualRefund = {
                refundedAt: new Date().toISOString(),
                refundedBy: 'system_cron',
                refundedRole: 'system',
                refundLedgerId: refundEntry?.id || null,
                refundAmount,
              };
            }
          }

          locked.data = JSON.stringify(mergedData);
          await locked.save({ transaction: tr });

          if (['SUCCESS', 'FAILED'].includes(serviceResponse.status)) {
            await PayoutAuditLog.create({
              payout_id: locked.id,
              action: 'SEVENPAY_CRON_RESOLVED',
              details: {
                reference_id: locked.reference_id,
                from: previousStatus,
                to: serviceResponse.status,
                paymentId: serviceResponse.paymentId || storedPaymentId || null,
                bankReferenceNo: serviceResponse.bankReferenceNo || null,
                rawResponse: serviceResponse.rawResponse || null,
                resolvedByCron: true,
                refundRequired: serviceResponse.status === 'FAILED',
                refundLedgerId: refundEntry?.id || null,
                autoRefunded: !!refundEntry,
              },
            }, { transaction: tr });
          }

          await tr.commit();

          const msg = serviceResponse.status === 'PENDING'
            ? `[cron] refreshed SevenPay payout ${locked.reference_id} (${sequenceLabel}) -> PENDING`
            : `[cron] resolved SevenPay payout ${locked.reference_id} (${sequenceLabel}) -> ${serviceResponse.status}`;
          console.log(msg);
          appendLog(msg);
        } catch (err) {
          await tr.rollback();
          const msg = `[cron] SevenPay transaction failed for payout ${tx.id} (${sequenceLabel}) ${err.message || err}`;
          console.error(msg, err);
          appendLog(msg);
        }
      } catch (err) {
        const msg = `[cron] SevenPay status check failed for payout ${tx.id} (${sequenceLabel}) (${tx.reference_id}) ${err.message || err}`;
        console.error(msg, err);
        appendLog(msg);
      }
    }
  } finally {
    resolvePendingInFlight = false;
  }
}

if (ENABLE_SEVENPAY_PENDING_CRON) {
  cron.schedule(SEVENPAY_PENDING_CRON_SCHEDULE, () => {
    resolvePendingSevenpay().catch((err) => {
      const msg = `resolvePendingSevenpay error ${err.message || err}`;
      console.error(msg, err);
      appendLog(msg);
    });
  });
} else {
  const msg = '[cron] SevenPay pending resolver is disabled. Set ENABLE_SEVENPAY_PENDING_CRON=true to enable it.';
  console.log(msg);
  appendLog(msg);
}

module.exports = { resolvePendingSevenpay };

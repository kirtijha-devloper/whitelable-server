const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { Op } = require('sequelize');
const BillAvenuePayment = require('../models/BillAvenuePayment');
const Ledger = require('../models/Ledger');
const ledgerService = require('../services/ledgerService');
const billAvenueService = require('../services/cc/billAvenue/billAvenueService');

const LOG_PREFIX = '[cron] resolvePendingBillAvenueCcBill';
const LOG_FILE = path.resolve(__dirname, '../logs/billavenue-pending-cron.log');
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

function appendLog(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  fs.appendFile(LOG_FILE, line, (err) => {
    if (err) {
      console.error(`${LOG_PREFIX} log write error:`, err);
    }
  });
}

function auditLog(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}`;
  console.log(line);
  appendLog(message);
}

function auditError(message, error) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ERROR: ${message} ${error ? (error.message || error) : ''}`;
  console.error(line);
  appendLog(line);
}

const ENABLE_BILLAVENUE_PENDING_CRON = process.env.ENABLE_BILLAVENUE_PENDING_CRON !== 'false';
const BILLAVENUE_PENDING_CRON_SCHEDULE = process.env.BILLAVENUE_PENDING_CRON_SCHEDULE || '0 */3 * * * *';

let inFlight = false;

async function resolvePendingBillAvenueCcBill() {
  if (inFlight) return;
  inFlight = true;

  try {
    const pending = await BillAvenuePayment.findAll({
      where: {
        status: {
          [Op.in]: ['pending', 'PENDING', 'processing', 'PROCESSING', 'queued', 'QUEUED'],
        },
      },
      limit: 50,
      order: [['updatedAt', 'ASC'], ['createdAt', 'ASC']],
    });

    if (!pending.length) {
      auditLog(`${LOG_PREFIX}: no pending BillAvenuePayment rows found`);
      return;
    }

    auditLog(`${LOG_PREFIX}: found ${pending.length} pending row(s)`);

    for (const record of pending) {
      try {
        const respObj = record.response;
        const extractedReqId =
          respObj?._requestId ||
          respObj?.requestId ||
          respObj?.data?._requestId ||
          respObj?.data?.requestId ||
          respObj?.transactionStatusResp?.payRequestId;

        const reqIdToUse = extractedReqId && String(extractedReqId).trim().length > 0
          ? String(extractedReqId).trim()
          : null;
        const txnRefIdToUse = record.transaction_ref_id ? String(record.transaction_ref_id).trim() : null;

        if (!reqIdToUse && !txnRefIdToUse) {
          const createdAtDate = new Date(record.createdAt || record.created_at || Date.now());
          const ageHours = (Date.now() - createdAtDate.getTime()) / (1000 * 60 * 60);

          if (ageHours >= 24) {
            auditLog(`${LOG_PREFIX}: marking id=${record.id} as failed (>24h old and no requestId/transaction_ref_id, age=${ageHours.toFixed(1)}h)`);
            record.status = 'failed';
            record.response_code = 'AUTO_FAILED_24H';
            const existingResp = (typeof record.response === 'object' && record.response !== null) ? record.response : {};
            record.response = {
              ...existingResp,
              cronAutoFailedReason: 'Marked failed by cron: older than 24 hours without requestId or transaction_ref_id',
              cronAutoFailedAt: new Date().toISOString(),
            };
            await record.save();

            // Reverse ledger debit on failure if not already reversed
            const refundAmount = parseFloat(record.transaction_amount) || 0;
            if (refundAmount > 0 && record.user_id) {
              const existingRefund = await Ledger.findOne({
                where: {
                  transaction_type: 'billavenue_payment_reversal',
                  reference_id: record.id,
                  reference_table: 'BillAvenuePayments',
                },
              });

              if (!existingRefund) {
                await ledgerService.createLedgerEntry({
                  userId: record.user_id,
                  transactionType: 'billavenue_payment_reversal',
                  transactionId: record.transaction_ref_id || null,
                  referenceId: record.id,
                  referenceTable: 'BillAvenuePayments',
                  description: `Reversed — BillAvenue payment auto-failed (>24h without ref ID)`,
                  credit: refundAmount,
                  metadata: {
                    biller_id: record.biller_id,
                    response_code: 'AUTO_FAILED_24H',
                    cron_auto_failed: true,
                  },
                });
                auditLog(`${LOG_PREFIX}: reversed wallet debit for id=${record.id} amount=₹${refundAmount}`);
              }
            }
          } else {
            auditLog(`${LOG_PREFIX}: skipping id=${record.id} (no requestId or transaction_ref_id, age=${ageHours.toFixed(1)}h < 24h)`);
          }
          continue;
        }

        auditLog(`${LOG_PREFIX}: checking status for id=${record.id} reqId=${reqIdToUse || 'none'} txnRefId=${txnRefIdToUse || 'none'}`);

        const result = await billAvenueService.getTransactionStatus({
          requestId: reqIdToUse,
          transactionRefId: txnRefIdToUse,
        });

        const payload = result?.data || result;
        const statusObj =
          payload?.transactionStatusResp ||
          payload?.transactionStatusResponse ||
          payload?.extTransactionStatusResponse ||
          payload?.ExtTransactionStatusResponse ||
          payload?.data?.transactionStatusResp ||
          payload?.data ||
          payload;

        const txnList = statusObj?.txnList;
        const txnItem = Array.isArray(txnList) ? txnList[0] : (txnList || statusObj);

        const resCode = String(
          statusObj?.responseCode || txnItem?.responseCode || statusObj?.code || ''
        );
        const resReason =
          statusObj?.responseReason ||
          txnItem?.responseReason ||
          statusObj?.message ||
          '';
        const rawStatus = String(
          txnItem?.txnStatus || statusObj?.txnStatus || statusObj?.status || ''
        ).toUpperCase();

        let nextStatus = 'pending';
        if (rawStatus === 'SUCCESS' || resCode === '000' || resCode === '00') {
          nextStatus = 'success';
        } else if (
          rawStatus === 'FAILURE' ||
          rawStatus === 'FAILED' ||
          (resCode && resCode !== '000' && resCode !== '00' && resCode !== '205')
        ) {
          nextStatus = 'failed';
        }

        auditLog(`${LOG_PREFIX}: id=${record.id} -> rawStatus=${rawStatus} resCode=${resCode} resolvedStatus=${nextStatus}`);

        if (nextStatus === 'success') {
          record.status = 'success';
          record.response_code = resCode || '000';
          await record.save();
        } else if (nextStatus === 'failed') {
          record.status = 'failed';
          record.response_code = resCode || 'FAILED';
          await record.save();

          // Reverse ledger debit on failure if not already reversed
          const refundAmount = parseFloat(record.transaction_amount) || 0;
          if (refundAmount > 0 && record.user_id) {
            const existingRefund = await Ledger.findOne({
              where: {
                transaction_type: 'billavenue_payment_reversal',
                reference_id: record.id,
                reference_table: 'BillAvenuePayments',
              },
            });

            if (!existingRefund) {
              await ledgerService.createLedgerEntry({
                userId: record.user_id,
                transactionType: 'billavenue_payment_reversal',
                transactionId: record.transaction_ref_id || null,
                referenceId: record.id,
                referenceTable: 'BillAvenuePayments',
                description: `Reversed — BillAvenue payment failed (${resReason || resCode || 'FAILED'})`,
                credit: refundAmount,
                metadata: {
                  biller_id: record.biller_id,
                  response_code: resCode,
                  transaction_ref_id: record.transaction_ref_id,
                  cron_resolved: true,
                },
              });
              auditLog(`${LOG_PREFIX}: reversed wallet debit for id=${record.id} amount=₹${refundAmount}`);
            }
          }
        }
      } catch (err) {
        auditError(`${LOG_PREFIX}: error for BillAvenuePayment id=${record.id}:`, err);
      }
    }
  } catch (err) {
    auditError(`${LOG_PREFIX} error:`, err);
  } finally {
    inFlight = false;
  }
}

if (ENABLE_BILLAVENUE_PENDING_CRON) {
  cron.schedule(BILLAVENUE_PENDING_CRON_SCHEDULE, () => {
    resolvePendingBillAvenueCcBill().catch((err) => {
      auditError(`${LOG_PREFIX} fatal:`, err);
    });
  });
  auditLog(`${LOG_PREFIX} enabled with schedule: ${BILLAVENUE_PENDING_CRON_SCHEDULE}`);
} else {
  auditLog(`${LOG_PREFIX} disabled via env`);
}

module.exports = { resolvePendingBillAvenueCcBill };

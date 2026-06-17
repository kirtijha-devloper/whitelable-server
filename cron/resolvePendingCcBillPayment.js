const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
const { Op } = require('sequelize');
const CcBillPayment = require('../models/CcBillPayment');
const Ledger = require('../models/Ledger');
const ledgerService = require('../services/ledgerService');

const LOG_PREFIX = '[cron] resolvePendingCcBillPayment';
const LOG_FILE = path.resolve(__dirname, '../logs/ccbill-pending-cron.log');
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

function appendLog(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  fs.appendFile(LOG_FILE, line, (err) => {
    if (err) {
      console.error('[cron] resolvePendingCcBillPayment log write error:', err);
    }
  });
}

function auditLog(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}`;
  console.log(line);
  fs.appendFile(LOG_FILE, `${line}\n`, (err) => {
    if (err) {
      console.error('[cron] resolvePendingCcBillPayment log write error:', err);
    }
  });
}

function auditError(message, error) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ERROR: ${message}`;
  console.error(line, error || '');
  fs.appendFile(LOG_FILE, `${line}${error ? ' ' + (error.message || error) : ''}\n`, (err) => {
    if (err) {
      console.error('[cron] resolvePendingCcBillPayment log write error:', err);
    }
  });
}

function normalizeInstantPayResponse(resp) {
  // InstantPay responses may include transactionStatusCode, statuscode, or status.
  const data = resp?.data ?? resp;
  const statuscode = data?.transactionStatusCode ?? data?.statuscode ?? data?.statusCode ?? resp?.data?.transactionStatusCode ?? resp?.data?.statuscode ?? resp?.data?.statusCode ?? resp?.statuscode ?? resp?.statusCode ?? null;
  const status = data?.status ?? resp?.status ?? resp?.data?.status ?? null;
  return { statuscode: statuscode ? statuscode.toString().toUpperCase() : null, status: status ? status.toString().toUpperCase() : null, raw: resp };
}

function buildInstantPayHeaders() {
  const resolvedOutlet = parseInt(process.env.IPAY_OUTLET_ID, 10);
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Ipay-Auth-Code': process.env.IPAY_AUTH_CODE,
    'X-Ipay-Client-Id': process.env.IPAY_CLIENT_ID,
    'X-Ipay-Client-Secret': process.env.IPAY_CLIENT_SECRET,
    'X-Ipay-Endpoint-Ip': process.env.IPAY_ENDPOINT_IP,
    'X-Ipay-Outlet-Id': Number.isNaN(resolvedOutlet) ? undefined : resolvedOutlet,
  };
}

async function checkInstantPayTxnStatus({ externalRef, transactionDate }) {
  // InstantPay endpoint used in your Laravel snippet
  const url = 'https://api.instantpay.in/reports/txnStatus';

  // The snippet uses `transactionDate` as input.
  // For status checks, send the date from the original transaction when available.
  const payload = {
    transactionDate: transactionDate || new Date().toISOString().slice(0, 10),
    externalRef,
  };

  const response = await axios.post(url, payload, {
    headers: buildInstantPayHeaders(),
    timeout: 30000,
  });

  return normalizeInstantPayResponse(response.data);
}

/**
 * Pending CcBillPayment status checker (skeleton).
 *
 * This cron will periodically find CcBillPayment rows in a pending state
 * and then call provider status-check logic.
 *
 * NOTE: Provider integration logic (how to call provider, map responses,
 * and how to update ledger/status) is intentionally left as TODO.
 */

// Tuneable via env vars
const ENABLE_CCBILL_PENDING_CRON = process.env.ENABLE_CCBILL_PENDING_CRON !== 'false';
const CCBILL_PENDING_CRON_SCHEDULE = process.env.CCBILL_PENDING_CRON_SCHEDULE || '0 */10 * * * *';

const PENDING_STATUS_CODES = (process.env.CCBILL_PENDING_STATUS_CODES || 'TUP')
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);

let inFlight = false;

async function resolvePendingCcBillPayment() {
  if (inFlight) return;
  inFlight = true;

  try {
    // Fetch pending rows (small batch to avoid long cron runs)
    const pendingFilter = PENDING_STATUS_CODES.length > 0 ? { [Op.in]: PENDING_STATUS_CODES } : 'TUP';
    const pending = await CcBillPayment.findAll({
      where: {
        statuscode: pendingFilter
      },
      limit: 50,
      order: [['updatedAt', 'ASC'], ['createdAt', 'ASC']]
    });

    if (!pending.length) {
      auditLog('[cron] resolvePendingCcBillPayment: no pending CcBillPayment rows found');
      return;
    }

    auditLog(`[cron] resolvePendingCcBillPayment: found ${pending.length} pending row(s)`);

    for (const row of pending) {
      try {
        // Need external ref for InstantPay txnStatus call
        const externalRef = row.external_ref;
        if (!externalRef) {
          auditLog(`${LOG_PREFIX}: skipping id=${row.id} (missing external_ref)`);
          continue;
        }

        auditLog(`${LOG_PREFIX}: checking InstantPay txnStatus for id=${row.id} external_ref=${externalRef}`);

        const transactionDate = new Date(row.createdAt).toISOString().slice(0, 10);
        const result = await checkInstantPayTxnStatus({ externalRef, transactionDate });

        const nextStatuscode = result.statuscode;
        const nextStatus = result.status;
        const failedStatuses = new Set(['TRP', 'FAILED', 'FAILURE', 'REJECTED', 'CANCELLED', 'REVERSED']);
        const successStatuses = new Set(['TXN', 'TUP']);
        const isUnknown = !nextStatuscode && !nextStatus;
        const isSuccess = nextStatuscode ? successStatuses.has(nextStatuscode) : false;
        const needsRefund = nextStatuscode ? failedStatuses.has(nextStatuscode) : nextStatus === 'FAILED';

        const updatedData = {
          statuscode: nextStatuscode || row.statuscode,
          status: nextStatus || row.status,
          response: result.raw,
        };

        if (needsRefund && row.user_id) {
          const refundAmount = parseFloat(row.transaction_amount) || 0;
          if (refundAmount > 0) {
            const existingRefund = await Ledger.findOne({
              where: {
                transaction_type: 'bbps_payment_reversal',
                reference_id: row.id,
                reference_table: 'CcBillPayments'
              }
            });

            if (!existingRefund) {
              await ledgerService.createLedgerEntry({
                userId: row.user_id,
                transactionType: 'bbps_payment_reversal',
                transactionId: externalRef || null,
                referenceId: row.id,
                referenceTable: 'CcBillPayments',
                description: `Reversed — BBPS CC payment failed (${nextStatus || 'FAILED'})`,
                credit: refundAmount,
                metadata: {
                  original_status: row.status,
                  original_statuscode: row.statuscode,
                  provider_statuscode: nextStatuscode,
                  provider_status: nextStatus,
                  external_ref: externalRef
                }
              });
            }
          }
        }

        await row.update(updatedData);

        if (isUnknown) {
          auditLog(`${LOG_PREFIX}: no actionable status for id=${row.id}; response saved`);
        } else {
          auditLog(`${LOG_PREFIX}: updated id=${row.id} -> statuscode=${nextStatuscode} status=${nextStatus}`);
        }
      } catch (err) {
        auditError(`${LOG_PREFIX}: error for CcBillPayment id=${row.id}:`, err);
      }
    }
  } catch (err) {
    auditError('[cron] resolvePendingCcBillPayment error:', err);
  } finally {
    inFlight = false;
  }
}

if (ENABLE_CCBILL_PENDING_CRON) {
  // Run on the schedule configured by env or default every 10 minutes.
  // node-cron format: 'sec min hour day month dayOfWeek'
  cron.schedule(CCBILL_PENDING_CRON_SCHEDULE, () => {
    resolvePendingCcBillPayment().catch((err) => {
      auditError('[cron] resolvePendingCcBillPayment fatal:', err);
    });
  });
} else {
  auditLog('[cron] resolvePendingCcBillPayment disabled. Set ENABLE_CCBILL_PENDING_CRON=true to enable it.');
}

module.exports = { resolvePendingCcBillPayment };


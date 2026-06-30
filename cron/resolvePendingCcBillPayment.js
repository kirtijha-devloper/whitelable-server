const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
const { Op } = require('sequelize');
const CcBillPayment = require('../models/CcBillPayment');
const User = require('../models/User');
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

function summarizeInstantPayResult(result) {
  const statuscode = result?.statuscode || result?.status || null;
  const status = result?.status || null;
  const raw = result?.raw ?? result;
  return {
    statuscode: statuscode ? statuscode.toString().toUpperCase() : null,
    status: status ? status.toString().toUpperCase() : null,
    hasData: !!raw,
    rawType: raw ? Object.prototype.toString.call(raw) : null,
  };
}

function buildInstantPayHeaders(outletId) {
  const resolvedOutlet = parseInt(outletId || process.env.IPAY_OUTLET_ID, 10);
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

async function checkInstantPayTxnStatus({ externalRef, transactionDate, outletId }) {
  // InstantPay endpoint used in your Laravel snippet
  const url = 'https://api.instantpay.in/reports/txnStatus';

  // The snippet uses `transactionDate` as input.
  // For status checks, send the date from the original transaction when available.
  const payload = {
    transactionDate: transactionDate || new Date().toISOString().slice(0, 10),
    externalRef,
  };

  const response = await axios.post(url, payload, {
    headers: buildInstantPayHeaders(outletId),
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

        const transactionDate = new Date(row.createdAt).toISOString().slice(0, 10);

        let userOutletId = null;
        if (row.user_id) {
          const user = await User.findByPk(row.user_id, { attributes: ['ipay_outlet_id'] });
          userOutletId = user?.ipay_outlet_id ?? null;
        }

        const requestDetails = {
          externalRef,
          transactionDate,
          outletId: userOutletId,
          rowId: row.id,
          userId: row.user_id,
          currentStatuscode: row.statuscode,
          currentStatus: row.status,
        };

        auditLog(`${LOG_PREFIX}: checking InstantPay txnStatus for id=${row.id} external_ref=${externalRef} outletId=${userOutletId || 'default'} currentStatuscode=${row.statuscode || 'unknown'} currentStatus=${row.status || 'unknown'}`);

        const result = await checkInstantPayTxnStatus({ externalRef, transactionDate, outletId: userOutletId });
        const summary = summarizeInstantPayResult(result);

        const nextStatuscode = summary.statuscode;
        const nextStatus = summary.status;
        const failedStatuses = new Set(['TRP', 'FAILED', 'SPE', 'FAILURE', 'REJECTED', 'CANCELLED', 'REVERSED']);
        const successStatuses = new Set(['TXN', 'TUP']);
        const isUnknown = !nextStatuscode && !nextStatus;
        const isSuccess = nextStatuscode ? successStatuses.has(nextStatuscode) : false;
        const isInvalidOutlet = nextStatuscode === 'OUI' || nextStatus?.includes('OUTLET');
        const needsRefund = nextStatuscode ? failedStatuses.has(nextStatuscode) : nextStatus === 'FAILED';

        const updatedData = {
          statuscode: nextStatuscode || row.statuscode,
          status: nextStatus || row.status,
          response: result.raw,
        };

        if (needsRefund && !isInvalidOutlet && row.user_id) {
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
                  external_ref: externalRef,
                  request: requestDetails,
                  responseSummary: summary,
                }
              });
            }
          }
        }

        // Keep invalid-outlet/authorization failures in pending so the merchant can fix
        // their outlet config without an automatic refund or permanent failure transition.
        if (isInvalidOutlet) {
          updatedData.status = row.status || 'pending';
          updatedData.statuscode = row.statuscode ?? 'TUP';
          auditLog(`${LOG_PREFIX}: invalid outlet detected for id=${row.id}; preserving pending status and saving response. request=${JSON.stringify(requestDetails)} responseSummary=${JSON.stringify(summary)}`);
        }

        await row.update(updatedData);

        if (isUnknown) {
          auditLog(`${LOG_PREFIX}: no actionable status for id=${row.id}; response saved. request=${JSON.stringify(requestDetails)} responseSummary=${JSON.stringify(summary)}`);
        } else if (isInvalidOutlet) {
          auditLog(`${LOG_PREFIX}: updated id=${row.id} -> invalid outlet response saved statuscode=${nextStatuscode} status=${nextStatus}`);
        } else {
          auditLog(`${LOG_PREFIX}: updated id=${row.id} -> statuscode=${nextStatuscode} status=${nextStatus} request=${JSON.stringify(requestDetails)} responseSummary=${JSON.stringify(summary)}`);
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


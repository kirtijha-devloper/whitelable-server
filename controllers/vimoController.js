const vimoService = require('../services/vimo.service');
const User = require('../models/User');
const PayoutBeneficiary = require('../models/PayoutBeneficiary');
const { Op } = require('sequelize');
const fs   = require('fs');
const path = require('path');

// ── File logger for Vimo callback events ─────────────────────────────────────
const VIMO_LOG_FILE = path.join(__dirname, '../logs/vimoCallback.log');

function vimoLog(level, message, data) {
  try {
    const ts   = new Date().toISOString();
    const extra = data !== undefined
      ? ' | ' + (typeof data === 'object' ? JSON.stringify(data) : String(data))
      : '';
    const line = `[${ts}] [${level}] ${message}${extra}\n`;
    fs.appendFileSync(VIMO_LOG_FILE, line);
    console.log(`[VimoCallback] [${level}] ${message}${extra}`);
  } catch (_) { /* never crash due to log failure */ }
}
// ─────────────────────────────────────────────────────────────────────────────

const normalizeError = (err, fallback) => {
  if (fallback && err.statusCode === undefined) {
    return { statusCode: fallback.statusCode || 500, message: fallback.message || 'Error', code: fallback.code || 'ERROR', details: err };
  }

  if (err && typeof err === 'object') {
    return {
      statusCode: err.statusCode || err.status || 500,
      message: err.message || err.error || 'Something went wrong',
      code: err.code || 'ERROR',
      details: err.details || err
    };
  }

  return { statusCode: 500, message: String(err), code: 'ERROR', details: err };
};
const PayoutTransaction = require('../models/PayoutTransaction');
const Ledger            = require('../models/Ledger');
const PayoutAuditLog    = require('../models/PayoutAuditLog');
const PayoutWebhookLog  = require('../models/PayoutWebhookLog');
const PayoutCharge      = require('../models/PayoutCharge');
const ledgerService     = require('../services/ledgerService');
const db                = require('../config/database');

/**
 * Resolves the service charge for a payout using the admin-configured
 * PayoutCharge rules:
 *   1. Look for an active slab for this merchant where min <= amount <= max
 *   2. Fall back to the is_default=true slab for this merchant
 *   3. Fall back to VIMO_DEFAULT_SERVICE_CHARGE env var (or 0)
 *
 * A slab may have a flat `amount`, a `percentage`, or both (they are summed).
 *
 * @returns {{ charge: number, source: string, slabId: number|null }}
 */
async function resolvePayoutServiceCharge(userId, payoutAmount) {
  const slabs = await PayoutCharge.findAll({
    where: { merchant_id: userId, status: 'active' },
    order: [['is_default', 'ASC']], // non-default first so we check slabs before fallback
  });

  // 1. Find a slab where amount falls within min..max range
  const matchingSlab = slabs.find(s => {
    const min = s.min !== null ? parseFloat(s.min) : 0;
    const max = s.max !== null ? parseFloat(s.max) : Infinity;
    return payoutAmount >= min && payoutAmount <= max;
  });

  // 2. Fall back to is_default slab for this merchant
  const slab = matchingSlab || slabs.find(s => s.is_default);

  if (slab) {
    const flat   = slab.amount     !== null ? parseFloat(slab.amount)     : 0;
    const pct    = slab.percentage !== null ? parseFloat(slab.percentage) : 0;
    const charge = +(flat + (pct / 100) * payoutAmount).toFixed(2);
    return { charge, source: 'db', slabId: slab.id, flat, pct };
  }

  // 3. Env-var fallback
  const charge = parseFloat(process.env.VIMO_DEFAULT_SERVICE_CHARGE || 0);
  return { charge, source: 'env', slabId: null, flat: charge, pct: 0 };
}

async function createPayout(req, res) {
  try {
  const {
    user_id,
    amount: rawAmount,
    beneficiary_id,
    beneficiaryBank,
    beneficiaryAccountNumber,
    beneficiaryIFSC,
    beneficiaryMobileNumber,
    beneficiaryName,
    paymentPurpose,
    paymentMode,
    merchantRefId: incomingMerchantRefId,
    tpin,
    purpose,
    lat,
    long: lng,
    udf1,
    udf2,
    udf3
  } = req.body;
  let merchantRefId = incomingMerchantRefId;
  let selectedBeneficiary = null;
  if (beneficiary_id) {
    selectedBeneficiary = await PayoutBeneficiary.findOne({ where: { id: beneficiary_id, user_id } });
    if (!selectedBeneficiary) {
      return res.status(404).json({ success: false, message: 'Beneficiary not found' });
    }
  }

  const resolvedBeneficiaryBank = beneficiaryBank || selectedBeneficiary?.bank_name || null;
  const resolvedBeneficiaryAccountNumber = beneficiaryAccountNumber || selectedBeneficiary?.account_number || null;
  const resolvedBeneficiaryIFSC = beneficiaryIFSC || selectedBeneficiary?.ifsc_code || null;
  const resolvedBeneficiaryMobileNumber = beneficiaryMobileNumber || selectedBeneficiary?.mobile || null;
  const resolvedBeneficiaryName = beneficiaryName || selectedBeneficiary?.name || null;
  // beneficiaryLocation = state code from DB (e.g. 'JH'); never use branch_name which may hold coordinates.
  const resolvedBeneficiaryLocation = selectedBeneficiary?.state || null;

  const missingBeneficiaryFields = [];
  if (!resolvedBeneficiaryBank) missingBeneficiaryFields.push('beneficiaryBank');
  if (!resolvedBeneficiaryAccountNumber) missingBeneficiaryFields.push('beneficiaryAccountNumber');
  if (!resolvedBeneficiaryIFSC) missingBeneficiaryFields.push('beneficiaryIFSC');
  if (!resolvedBeneficiaryName) missingBeneficiaryFields.push('beneficiaryName');
  if (missingBeneficiaryFields.length > 0) {
    return res.status(400).json({ success: false, message: 'Beneficiary information missing', missing: missingBeneficiaryFields });
  }

  if (!resolvedBeneficiaryLocation) {
    return res.status(400).json({ success: false, message: 'Beneficiary location is required from saved beneficiary state' });
  }

  if (!user_id) {
    return res.status(400).json({ success: false, message: 'user_id is required' });
  }

  // NOTE: tpin is optional for Vimo payload; can be enforced by frontend or internal auth if needed.
  // if (!tpin) {
  //   return res.status(400).json({ success: false, message: 'tpin is required' });
  // }

  const user = await User.findByPk(user_id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (!user.is_payout_enabled) {
    return res.status(403).json({ success: false, message: 'Payout service is disabled for this user' });
  }

  const amount = parseFloat(rawAmount);
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid payout amount' });
  }

  // ── 3-minute duplicate payout guard ────────────────────────────────────────
  // Prevent accidental double-submission: same user / same amount / same
  // beneficiary within the last 3 minutes that is still non-terminal.
  if (beneficiary_id || resolvedBeneficiaryAccountNumber) {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    const dupWhere = {
      merchant_id: user_id,
      amount,
      status: { [Op.notIn]: ['FAILED', 'REVERSED', 'CANCELLED'] },
      createdAt: { [Op.gte]: threeMinutesAgo },
    };
    if (beneficiary_id) dupWhere.beneficiary_id = beneficiary_id;
    const recentDup = await PayoutTransaction.findOne({ where: dupWhere });
    if (recentDup) {
      return res.status(429).json({
        success: false,
        message: 'A payout of the same amount to this beneficiary was already submitted within the last 3 minutes. Please wait before retrying.',
        retryAfter: 180,
      });
    }
  }

  // Generate merchantRefId if not supplied (idempotency key).
  if (!merchantRefId) {
    merchantRefId = await generateMerchantRefId();
  }

  // ── Resolve service charge from DB rules (admin-configured PayoutCharge) ──
  const chargeResolution = await resolvePayoutServiceCharge(user_id, amount);
  const serviceCharge = chargeResolution.charge;
  const total_amount = amount + serviceCharge;

  vimoLog && vimoLog('INFO', 'Service charge resolved', {
    user_id,
    payoutAmount: amount,
    serviceCharge,
    chargeSource: chargeResolution.source,
    slabId: chargeResolution.slabId,
    flat: chargeResolution.flat,
    pct: chargeResolution.pct,
    total_amount,
  });

  const transaction = await db.transaction();
  try {
    // ── Row-level lock on user ─────────────────────────────────────────────
    // Serialises concurrent payout attempts for the same user so we can
    // do a safe balance check and prevent double-deduction.
    const lockedUser = await User.findByPk(user_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!lockedUser) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // ── Balance check ──────────────────────────────────────────────────────
    const currentBalance = parseFloat(lockedUser.wallet) || 0;
    if (currentBalance < total_amount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: ₹${currentBalance.toFixed(2)}, Required: ₹${total_amount.toFixed(2)}`,
      });
    }

    // ── merchantRefId uniqueness check (inside lock) ───────────────────────
    // Done here (not before) so two concurrent submissions with the same ref
    // are serialised by the user row lock above.
    const existingRef = await PayoutTransaction.findOne({
      where: { reference_id: merchantRefId },
      transaction,
    });
    if (existingRef) {
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        message: 'Duplicate merchantRefId',
        error: { code: 'DUPLICATE_REFERENCE', details: 'merchantRefId already used' },
      });
    }

    // ── Create payout record and debit ledger ──────────────────────────────
    const payoutTransaction = await PayoutTransaction.create({
      merchant_id: user_id,
      beneficiary_id: beneficiary_id || null,
      reference_id: merchantRefId || null,
      amount: amount,
      status: 'Processing',
      purpose: purpose || paymentPurpose || null,
      data: JSON.stringify({
        beneficiaryAccountNumber: resolvedBeneficiaryAccountNumber,
        beneficiaryIFSC: resolvedBeneficiaryIFSC,
        beneficiaryName: resolvedBeneficiaryName,
        beneficiaryBank: resolvedBeneficiaryBank,
      }),
      service_charge: serviceCharge,
    }, { transaction });

    // ── DB audit: record payout initiation with balance snapshot ────────────
    await PayoutAuditLog.create({
      payout_id: payoutTransaction.id,
      action: 'VIMO_PAYOUT_INIT',
      details: {
        user_id,
        amount,
        service_charge: serviceCharge,
        total_amount,
        beneficiary_id: beneficiary_id || null,
        beneficiary_account: resolvedBeneficiaryAccountNumber,
        beneficiary_ifsc: resolvedBeneficiaryIFSC,
        beneficiary_name: resolvedBeneficiaryName,
        merchant_ref_id: merchantRefId,
        opening_balance: currentBalance,
        closing_balance: +(currentBalance - total_amount).toFixed(2),
      }
    }, { transaction });

    await ledgerService.createPayoutEntry({
      userId: user_id,
      payoutTransactionId: payoutTransaction.id,
      amount: total_amount,
      description: `Vimo payout ${merchantRefId || payoutTransaction.id}`,
      status: 'pending',
      metadata: {
        service: 'vimo',
        beneficiaryBank: resolvedBeneficiaryBank,
        beneficiaryAccountNumber: resolvedBeneficiaryAccountNumber,
        beneficiaryIFSC: resolvedBeneficiaryIFSC,
        beneficiaryMobileNumber: resolvedBeneficiaryMobileNumber,
        beneficiaryName: resolvedBeneficiaryName,
        beneficiaryLocation: resolvedBeneficiaryLocation,
        beneficiary_id: beneficiary_id || null,
        paymentPurpose,
        paymentMode,
        merchantRefId,
        lat,
        long: lng
      }
    }, { transaction });

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    const normalized = normalizeError(err);
    return res.status(normalized.statusCode || 500).json({ success: false, message: normalized.message, error: normalized });
  }

  // call external provider, then update payout status
  try {
    const result = await vimoService.createPayout({
      amount,
      merchantRefId,
      beneficiaryBank: resolvedBeneficiaryBank,
      paymentPurpose,
      paymentMode,
      beneficiaryAccountNumber: resolvedBeneficiaryAccountNumber,
      beneficiaryIFSC: resolvedBeneficiaryIFSC,
      beneficiaryMobileNumber: resolvedBeneficiaryMobileNumber,
      beneficiaryName: resolvedBeneficiaryName,
      beneficiaryLocation: resolvedBeneficiaryLocation,
      lat,
      long: lng,
      udf1: udf1 || '',
      udf2: udf2 || '',
      udf3: udf3 || ''
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      responseCode: result.responseCode,
      merchantRefId,
      service_charge: serviceCharge,
      data: result.data
    });
  } catch (error) {
    // NOTE: we choose not to rollback ledger here; a separate job/webhook should settle
    console.error('Vimo payout failed', error);
    const normalized = normalizeError(error);
    return res.status(normalized.statusCode || 500).json({
      success: false,
      message: normalized.message,
      error: normalized,
    });
  }
  } catch (err) {
    console.error('Vimo createPayout unhandled error', err);
    const normalized = normalizeError(err);
    return res.status(normalized.statusCode || 500).json({ success: false, message: normalized.message, error: normalized });
  }
}

async function fetchBankList(req, res) {
  try {
    const result = await vimoService.fetchBankList();
    return res.status(200).json({
      success: true,
      message: result.message,
      responseCode: result.responseCode,
      data: result.data
    });
  } catch (error) {
    const normalized = normalizeError(error, {
      statusCode: 502,
      message: 'Failed to fetch bank list',
      code: 'BANK_API_ERROR'
    });
    return res.status(normalized.statusCode || 500).json({
      success: false,
      message: normalized.message,
      error: normalized
    });
  }
}

async function fetchPurposeList(req, res) {
  try {
    const result = await vimoService.fetchPurposeList();
    return res.status(200).json({
      success: true,
      message: result.message,
      responseCode: result.responseCode,
      data: result.data
    });
  } catch (error) {
    const normalized = normalizeError(error, {
      statusCode: 502,
      message: 'Failed to fetch purpose list',
      code: 'BANK_API_ERROR'
    });
    return res.status(normalized.statusCode || 500).json({
      success: false,
      message: normalized.message,
      error: normalized
    });
  }
}

async function fetchStateList(req, res) {
  try {
    const result = await vimoService.fetchStateList();
    return res.status(200).json({
      success: true,
      message: result.message,
      responseCode: result.responseCode,
      data: result.data
    });
  } catch (error) {
    const normalized = normalizeError(error, {
      statusCode: 502,
      message: 'Failed to fetch state list',
      code: 'BANK_API_ERROR'
    });
    return res.status(normalized.statusCode || 500).json({
      success: false,
      message: normalized.message,
      error: normalized
    });
  }
}

function isVimoConfigured() {
  return (
    Boolean(process.env.VIMO_BASE_URL) &&
    Boolean(process.env.VIMO_SECRET_KEY) &&
    Boolean(process.env.VIMO_SALT_KEY) &&
    Boolean(process.env.VIMO_ENCRYPTDECRYPT_KEY || process.env.VIMO_ENCRYPT_KEY) &&
    Boolean(process.env.VIMO_USER_ID)
  );
}

async function fetchTokenStatus(req, res) {
  if (!isVimoConfigured()) {
    return res.status(503).json({
      success: false,
      message: 'Vimo is not fully configured. Check VIMO_* environment variables.',
      error: {
        statusCode: 503,
        code: 'VIMO_CONFIG_MISSING'
      }
    });
  }

  try {
    const result = await vimoService.getAuthorizeTokenResponse({
      forceRefresh: req.query.forceRefresh === 'true'
    });
    return res.status(200).json({
      success: true,
      message: result.message || 'Token status fetched',
      responseCode: result.responseCode || '000',
      data: result.data
    });
  } catch (error) {
    const normalized = normalizeError(error);
    return res.status(normalized.statusCode || 500).json({
      success: false,
      message: normalized.message,
      error: normalized
    });
  }
}

async function generateMerchantRefId() {
  const last = await PayoutTransaction.findOne({
    where: {
      reference_id: {
        [Op.like]: 'APPV%'
      }
    },
    order: [['createdAt', 'DESC']],
  });

  if (!last || !last.reference_id) {
    return 'APPV00000001';
  }

  const numeric = parseInt(last.reference_id.replace(/^APPV0*/, ''), 10) || 0;
  const next = numeric + 1;
  return `APPV${next.toString().padStart(8, '0')}`;
}

async function getPayoutReference(req, res) {
  try {
    const reference = await generateMerchantRefId();
    return res.status(200).json({ success: true, merchantRefId: reference });
  } catch (err) {
    const normalized = normalizeError(err, { statusCode: 500, message: 'Could not generate merchantRefId', code: 'REFERENCE_GENERATION_FAILED' });
    return res.status(normalized.statusCode || 500).json({ success: false, message: normalized.message, error: normalized });
  }
}

async function handleCallback(req, res) {
  const payload = req.body;
  const receivedAt = new Date().toISOString();
  const sourceIp = req.ip || req.connection?.remoteAddress;

  vimoLog('INFO', '--- Vimo callback received ---', { receivedAt, ip: sourceIp, payload });

  // ── DB: persist raw payload immediately (outside transaction) ─────────────
  // This guarantees we always have the raw inbound data even if processing fails.
  try {
    await PayoutWebhookLog.create({ payload, source_ip: sourceIp });
  } catch (logErr) {
    vimoLog('WARN', 'PayoutWebhookLog.create failed (non-fatal)', { message: logErr.message });
  }

  // Always respond 200 immediately so Vimo doesn't retry.
  res.status(200).json({ successStatus: true, message: 'Success', responseCode: '000' });

  // Process in background after response is sent.
  setImmediate(async () => {
    try {
      const merchantRefId = payload.merchantRefId || payload.merchant_ref_id || payload.referenceId;
      const vimoStatus   = (payload.status || payload.txnStatus || '').toUpperCase();

      vimoLog('INFO', 'Parsed callback fields', { merchantRefId, vimoStatus });

      if (!merchantRefId) {
        vimoLog('WARN', 'No merchantRefId in payload — skipping processing');
        return;
      }

      const TERMINAL = ['SUCCESS', 'FAILED', 'REVERSED', 'CANCELLED'];

      // ── Open transaction FIRST, then lock the row ──────────────────────────
      const tr = await db.transaction();
      vimoLog('INFO', `DB transaction opened for ref: ${merchantRefId}`);
      try {
        const txn = await PayoutTransaction.findOne({
          where: { reference_id: merchantRefId },
          transaction: tr,
          lock: tr.LOCK.UPDATE,
        });

        if (!txn) {
          await tr.commit();
          vimoLog('WARN', `No PayoutTransaction found for ref: ${merchantRefId} — nothing to update`);
          return;
        }

        vimoLog('INFO', `Found PayoutTransaction`, { id: txn.id, currentStatus: txn.status, amount: txn.amount, service_charge: txn.service_charge, merchant_id: txn.merchant_id });

        // Terminal check inside the lock.
        if (TERMINAL.includes((txn.status || '').toUpperCase())) {
          await PayoutAuditLog.create({
            payout_id: txn.id,
            action: 'VIMO_SKIP_TERMINAL',
            details: { merchantRefId, vimoStatus, currentStatus: txn.status, reason: 'Already in terminal state' }
          }, { transaction: tr });
          await tr.commit();
          vimoLog('INFO', `Transaction ${merchantRefId} already terminal (${txn.status}) — skipping update`);
          return;
        }

        // Map Vimo status to internal status.
        let newStatus = 'Processing';
        if (['SUCCESS', 'TRANSFERRED'].includes(vimoStatus)) newStatus = 'SUCCESS';
        else if (['FAILED', 'FAILURE', 'REJECTED', 'REVERSED', 'CANCELLED'].includes(vimoStatus)) newStatus = 'FAILED';

        vimoLog('INFO', `Status mapping: vimo=${vimoStatus} → internal=${newStatus}`);

        const previousStatus = txn.status;
        txn.status = newStatus;
        if (payload.utr || payload.bankRefNo) {
          const existing = txn.data ? JSON.parse(txn.data) : {};
          txn.data = JSON.stringify({ ...existing, utr: payload.utr || payload.bankRefNo, raw: payload });
          vimoLog('INFO', `UTR/bankRefNo stored`, { utr: payload.utr || payload.bankRefNo });
        }
        await txn.save({ transaction: tr });
        vimoLog('INFO', `PayoutTransaction ${txn.id} status updated to ${newStatus}`);

        // ── DB audit: status transition ──────────────────────────────────────
        await PayoutAuditLog.create({
          payout_id: txn.id,
          action: 'VIMO_STATUS_UPDATE',
          details: {
            merchantRefId,
            previousStatus,
            newStatus,
            vimoStatus,
            utr: payload.utr || payload.bankRefNo || null,
            source_ip: sourceIp,
          }
        }, { transaction: tr });

        // Update matching pending ledger entry.
        const ledgerStatus = newStatus === 'SUCCESS' ? 'completed' : newStatus === 'FAILED' ? 'failed' : 'pending';
        const [ledgerRowsUpdated] = await Ledger.update(
          { status: ledgerStatus },
          { where: { reference_id: txn.id, reference_table: 'PayoutTransactions', status: 'pending' }, transaction: tr }
        );
        vimoLog('INFO', `Ledger entries updated`, { rowsUpdated: ledgerRowsUpdated, newLedgerStatus: ledgerStatus });

        // On failure: refund only if no refund has been issued yet.
        if (newStatus === 'FAILED') {
          const existingRefund = await Ledger.findOne({
            where: {
              transaction_type: 'payout_refund',
              reference_id: txn.id,
              reference_table: 'PayoutTransactions',
            },
            transaction: tr,
          });

          if (existingRefund) {
            vimoLog('WARN', `Refund already exists for PayoutTransaction ${txn.id} (Ledger id=${existingRefund.id}) — duplicate refund blocked`);
            // ── DB audit: duplicate refund blocked ────────────────────────
            await PayoutAuditLog.create({
              payout_id: txn.id,
              action: 'VIMO_REFUND_BLOCKED',
              details: { merchantRefId, existingLedgerId: existingRefund.id, reason: 'Duplicate refund prevented' }
            }, { transaction: tr });
          } else {
            const refundAmount = parseFloat(txn.amount || 0) + parseFloat(txn.service_charge || 0);
            vimoLog('INFO', `Issuing refund credit`, { merchant_id: txn.merchant_id, refundAmount });
            await ledgerService.createLedgerEntry({
              userId: txn.merchant_id,
              transactionType: 'payout_refund',
              referenceId: txn.id,
              referenceTable: 'PayoutTransactions',
              description: `Refund for failed Vimo payout ${merchantRefId}`,
              credit: refundAmount,
              status: 'completed',
            }, { transaction: tr });
            vimoLog('INFO', `Refund credit created for merchant ${txn.merchant_id}, amount ₹${refundAmount}`);
            // ── DB audit: refund issued ────────────────────────────────────
            await PayoutAuditLog.create({
              payout_id: txn.id,
              action: 'VIMO_REFUND_ISSUED',
              details: { merchantRefId, merchant_id: txn.merchant_id, refundAmount, amount: txn.amount, service_charge: txn.service_charge }
            }, { transaction: tr });
          }
        }

        await tr.commit();
        vimoLog('INFO', `DB transaction committed — ref: ${merchantRefId} finalised as ${newStatus}`);
      } catch (err) {
        await tr.rollback();
        vimoLog('ERROR', `DB error — transaction rolled back for ref: ${merchantRefId}`, { message: err.message, stack: err.stack });
      }
    } catch (err) {
      vimoLog('ERROR', 'Unexpected error in handleCallback background processing', { message: err.message, stack: err.stack });
    }
  });
}

// Vimo beneficiary management
async function createBeneficiary(req, res) {
  const { name, account_number, ifsc_code, bank_name, branch_name, state, mobile, email } = req.body;
  const userId = req.user?.id;

  if (!userId || !name || !account_number || !ifsc_code || !bank_name) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const beneficiary = await PayoutBeneficiary.create({
    user_id: userId,
    name,
    account_number,
    ifsc_code,
    bank_name,
    branch_name: branch_name || null,
    state: state || null,
    mobile: mobile || null,
    email: email || null,
    is_verified: false
  });

  return res.status(201).json({ success: true, data: beneficiary });
}

async function listBeneficiaries(req, res) {
  const userIdFromToken = req.user?.id;

  if (!userIdFromToken) {
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  const list = await PayoutBeneficiary.findAll({ where: { user_id: userIdFromToken } });
  return res.status(200).json({ success: true, data: list });
}

async function updateBeneficiary(req, res) {
  const id = req.params.id;
  const beneficiary = await PayoutBeneficiary.findByPk(id);

  if (!beneficiary) {
    return res.status(404).json({ success: false, message: 'Beneficiary not found' });
  }

  await beneficiary.update(req.body);
  return res.status(200).json({ success: true, data: beneficiary });
}

async function deleteBeneficiary(req, res) {
  const id = req.params.id;
  const beneficiary = await PayoutBeneficiary.findByPk(id);

  if (!beneficiary) {
    return res.status(404).json({ success: false, message: 'Beneficiary not found' });
  }

  await beneficiary.destroy();
  return res.status(200).json({ success: true, message: 'Deleted' });
}

module.exports = {
  createPayout,
  fetchTokenStatus,
  fetchBankList,
  fetchPurposeList,
  fetchStateList,
  getPayoutReference,
  handleCallback,
  createBeneficiary,
  listBeneficiaries,
  updateBeneficiary,
  deleteBeneficiary
};

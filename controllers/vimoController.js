const vimoService = require('../services/vimo.service');
const User = require('../models/User');
const Beneficiary = require('../models/Beneficiary');
const { Op } = require('sequelize');
const { isAdmin, hasPermission, EMPLOYEE_PERMISSIONS } = require('../utils/permissions');
const {
  SERVICE_SETTING_KEYS,
  assertServiceEnabledOrRespond,
} = require('../services/serviceSettingsService');
const fs   = require('fs');
const path = require('path');

const VIMO_LOG_FILE = path.join(__dirname, '../logs/vimo.log');
const VIMO_CALLBACK_LOG_FILE = path.join(__dirname, '../logs/vimoCallback.log');

function vimoLog(level, message, data) {
  try {
    const ts = new Date().toISOString();
    const extra = data !== undefined
      ? ' | ' + (typeof data === 'object' ? JSON.stringify(data) : String(data))
      : '';
    const line = `[${ts}] [${level}] ${message}${extra}\n`;
    fs.appendFileSync(VIMO_LOG_FILE, line);
    console.log(`[Vimo] [${level}] ${message}${extra}`);
  } catch (_) { /* never crash due to log failure */ }
}

function vimoCallbackLog(level, message, data) {
  try {
    const ts = new Date().toISOString();
    const extra = data !== undefined
      ? ' | ' + (typeof data === 'object' ? JSON.stringify(data) : String(data))
      : '';
    const line = `[${ts}] [${level}] ${message}${extra}\n`;
    fs.appendFileSync(VIMO_CALLBACK_LOG_FILE, line);
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
const PayoutTransaction  = require('../models/PayoutTransaction');
const Ledger             = require('../models/Ledger');
const PayoutAuditLog     = require('../models/PayoutAuditLog');
const PayoutWebhookLog   = require('../models/PayoutWebhookLog');
const PayoutCharge       = require('../models/PayoutCharge');
const ledgerService      = require('../services/ledgerService');
const payoutReferenceService = require('../services/payoutReferenceService');
const db                 = require('../config/database');

/**
 * Resolves the service charge for a payout using the admin-configured
 * PayoutCharge slab rules (mirrors calculateBbpsCcCharge logic):
 *   - Find an active rule where from_amount <= payoutAmount <= to_amount
 *   - Apply rate as flat fee or percentage based on rate_type
 *   - Falls back to VIMO_DEFAULT_SERVICE_CHARGE env var (or 0)
 *
 * @returns {{ charge: number, source: string, slabId: number|null, rate: number, rate_type: string|null }}
 */
async function resolvePayoutServiceCharge(userId, payoutAmount) {
  const rule = await PayoutCharge.findOne({
    where: {
      is_active: true,
      from_amount: { [Op.lte]: payoutAmount },
      to_amount:   { [Op.gte]: payoutAmount },
    },
    order: [['from_amount', 'DESC']],
  });

  if (rule) {
    let charge;
    if (rule.rate_type === 'flat') {
      charge = parseFloat(rule.rate);
    } else {
      charge = parseFloat((payoutAmount * parseFloat(rule.rate)) / 100.0);
    }
    charge = +charge.toFixed(2);
    return { charge, source: 'db', slabId: rule.id, rate: parseFloat(rule.rate), rate_type: rule.rate_type };
  }

  // Env-var fallback
  const charge = parseFloat(process.env.VIMO_DEFAULT_SERVICE_CHARGE || 0);
  return { charge, source: 'env', slabId: null, rate: charge, rate_type: 'flat' };
}

function normalizeVimoPaymentPurpose(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const cleaned = input.trim();
  if (/^[A-Za-z0-9]{2,10}$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

function escapeSqlLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

async function getVimoBeneficiaryMonthlyTotal({ beneficiaryId, beneficiaryAccountNumber, beneficiaryIFSC }) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const where = {
    payout_provider: 'Vimo',
    createdAt: { [Op.gte]: monthStart, [Op.lt]: nextMonthStart },
    status: { [Op.notIn]: ['FAILED', 'REVERSED', 'CANCELLED'] },
  };

  if (beneficiaryId) {
    where.beneficiary_id = beneficiaryId;
  } else {
    const normalizedAccount = beneficiaryAccountNumber ? escapeSqlLike(beneficiaryAccountNumber) : null;
    const normalizedIfsc = beneficiaryIFSC ? escapeSqlLike(beneficiaryIFSC) : null;

    if (!normalizedAccount) {
      return 0;
    }

    where.data = { [Op.like]: `%"beneficiaryAccountNumber":"${normalizedAccount}"%` };
    if (normalizedIfsc) {
      where[Op.and] = [
        { data: { [Op.like]: `%"beneficiaryIFSC":"${normalizedIfsc}"%` } }
      ];
    }
  }

  const total = await PayoutTransaction.sum('amount', { where });
  return parseFloat(total || 0);
}

function formatVimoCoordinate(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'string' ? parseFloat(value.trim()) : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed.toFixed(8);
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
  const normalizedLat = formatVimoCoordinate(lat);
  const normalizedLong = formatVimoCoordinate(lng);
  let merchantRefId = incomingMerchantRefId;
  let selectedBeneficiary = null;

  if (!user_id) {
    return res.status(400).json({ success: false, message: 'user_id is required' });
  }

  if (beneficiary_id) {
    selectedBeneficiary = await Beneficiary.findOne({ where: { id: beneficiary_id, merchant_id: user_id } });
    if (!selectedBeneficiary) {
      return res.status(404).json({ success: false, message: 'Beneficiary not found' });
    }
  }

  const user = await User.findByPk(user_id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (!(await assertServiceEnabledOrRespond(res, SERVICE_SETTING_KEYS.VIMO_PAYOUT, user))) {
    return;
  }

  const resolvedBeneficiaryBank = beneficiaryBank || selectedBeneficiary?.bank_code || selectedBeneficiary?.bank_name || null;
  const resolvedBeneficiaryBankCode = await vimoService.resolveBankCode(resolvedBeneficiaryBank);
  if (selectedBeneficiary && !selectedBeneficiary.bank_code && resolvedBeneficiaryBankCode) {
    try {
      await selectedBeneficiary.update({ bank_code: resolvedBeneficiaryBankCode });
    } catch (_) {
      // best-effort backfill only; payout should still proceed if code is resolved
    }
  }

  const resolvedBeneficiaryAccountNumber = beneficiaryAccountNumber || selectedBeneficiary?.account_number || null;
  const resolvedBeneficiaryIFSC = beneficiaryIFSC || selectedBeneficiary?.ifsc_code || null;
  const resolvedBeneficiaryMobileNumber = beneficiaryMobileNumber || selectedBeneficiary?.mobile_number || null;
  const resolvedBeneficiaryName = beneficiaryName || selectedBeneficiary?.beneficiary_name || null;
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

  if (!resolvedBeneficiaryBankCode) {
    return res.status(400).json({
      success: false,
      message: 'Unable to resolve Vimo bank code for beneficiaryBank. Provide a valid bank code or bank name from /api/vimo/banks.',
      beneficiaryBank: resolvedBeneficiaryBank,
    });
  }

  if (!resolvedBeneficiaryLocation) {
    return res.status(400).json({ success: false, message: 'Beneficiary location is required from saved beneficiary state' });
  }

  // NOTE: tpin is optional for Vimo payload; can be enforced by frontend or internal auth if needed.
  // if (!tpin) {
  //   return res.status(400).json({ success: false, message: 'tpin is required' });
  // }

  const amount = parseFloat(rawAmount);
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid payout amount' });
  }

  const normalizedPaymentPurpose = normalizeVimoPaymentPurpose(paymentPurpose || purpose || '');
  if (!normalizedPaymentPurpose) {
    return res.status(400).json({
      success: false,
      message: 'Invalid paymentPurpose. It must be alphanumeric and 2-10 characters long. Use GET /api/vimo/purposes to fetch valid values.',
    });
  }

  if (normalizedLat == null || normalizedLong == null) {
    return res.status(400).json({
      success: false,
      message: 'lat and long are required for Vimo payout and must be valid coordinates.',
    });
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

  // ── Vimo beneficiary monthly cap ──────────────────────────────────────────
  const beneficiaryMonthlyTotal = await getVimoBeneficiaryMonthlyTotal({
    beneficiaryId: beneficiary_id,
    beneficiaryAccountNumber: resolvedBeneficiaryAccountNumber,
    beneficiaryIFSC: resolvedBeneficiaryIFSC,
  });

  const beneficiaryLimit = 500000;
  if (beneficiaryMonthlyTotal + amount > beneficiaryLimit) {
    return res.status(400).json({
      success: false,
      message: `Vimo payout limit exceeded for this beneficiary in the current calendar month. Maximum allowed is ₹${beneficiaryLimit.toLocaleString('en-IN')}.`,
      monthlyTotal: beneficiaryMonthlyTotal,
      attemptedAmount: amount,
      beneficiaryLimit,
    });
  }

  // Generate merchantRefId if not supplied (idempotency key).
  if (!merchantRefId) {
    merchantRefId = await payoutReferenceService.getNextPayoutReference({ provider: 'vimo', userId: user_id });
  }

  // ── Resolve service charge from DB rules (admin-configured PayoutCharge) ──
  const chargeResolution = await resolvePayoutServiceCharge(user_id, amount);
  const serviceCharge = chargeResolution.charge;
  const total_amount = amount + serviceCharge;

  const vimoRequestPayload = {
    amount,
    merchantRefId,
    beneficiaryBank: resolvedBeneficiaryBankCode,
    paymentPurpose: normalizedPaymentPurpose,
    paymentMode,
    beneficiaryAccountNumber: resolvedBeneficiaryAccountNumber,
    beneficiaryIFSC: resolvedBeneficiaryIFSC,
    beneficiaryMobileNumber: resolvedBeneficiaryMobileNumber,
    beneficiaryName: resolvedBeneficiaryName,
    beneficiaryLocation: resolvedBeneficiaryLocation,
    lat: normalizedLat,
    long: normalizedLong,
    udf1: udf1 || '',
    udf2: udf2 || '',
    udf3: udf3 || ''
  };

  vimoLog && vimoLog('INFO', 'Service charge resolved', {
    user_id,
    payoutAmount: amount,
    serviceCharge,
    chargeSource: chargeResolution.source,
    slabId: chargeResolution.slabId,
    rate: chargeResolution.rate,
    rate_type: chargeResolution.rate_type,
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
    const currentBalance = await ledgerService.getAvailableBalance(user_id);
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
      payout_provider: 'Vimo',
      amount: amount,
      status: 'Processing',
      purpose: purpose || paymentPurpose || null,
      data: JSON.stringify({
        beneficiaryAccountNumber: resolvedBeneficiaryAccountNumber,
        beneficiaryIFSC: resolvedBeneficiaryIFSC,
        beneficiaryName: resolvedBeneficiaryName,
        beneficiaryBank: resolvedBeneficiaryBankCode,
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
        charge_slab_id: chargeResolution.slabId,
        charge_source: chargeResolution.source,
        charge_rate: chargeResolution.rate,
        charge_rate_type: chargeResolution.rate_type,
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

    await PayoutAuditLog.create({
      payout_id: payoutTransaction.id,
      action: 'VIMO_PAYOUT_REQUEST',
      details: {
        merchantRefId,
        requestPayload: vimoRequestPayload,
      }
    }, { transaction });

    await ledgerService.createPayoutEntry({
      userId: user_id,
      payoutTransactionId: payoutTransaction.id,
      amount: total_amount,
      description: `Vimo payout ${merchantRefId || payoutTransaction.id}`,
      metadata: {
        service: 'vimo',
        beneficiaryBank: resolvedBeneficiaryBankCode,
        beneficiaryAccountNumber: resolvedBeneficiaryAccountNumber,
        beneficiaryIFSC: resolvedBeneficiaryIFSC,
        beneficiaryMobileNumber: resolvedBeneficiaryMobileNumber,
        beneficiaryName: resolvedBeneficiaryName,
        beneficiaryLocation: resolvedBeneficiaryLocation,
        beneficiary_id: beneficiary_id || null,
        paymentPurpose,
        paymentMode,
        merchantRefId,
        lat: normalizedLat,
        long: normalizedLong
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
      beneficiaryBank: resolvedBeneficiaryBankCode,
      paymentPurpose: normalizedPaymentPurpose,
      paymentMode,
      beneficiaryAccountNumber: resolvedBeneficiaryAccountNumber,
      beneficiaryIFSC: resolvedBeneficiaryIFSC,
      beneficiaryMobileNumber: resolvedBeneficiaryMobileNumber,
      beneficiaryName: resolvedBeneficiaryName,
      beneficiaryLocation: resolvedBeneficiaryLocation,
      lat: normalizedLat,
      long: normalizedLong,
      udf1: udf1 || '',
      udf2: udf2 || '',
      udf3: udf3 || ''
    });

    try {
      await PayoutAuditLog.create({
        payout_id: payoutTransaction.id,
        action: 'VIMO_PAYOUT_RESPONSE',
        details: {
          merchantRefId,
          responseCode: result.responseCode,
          message: result.message,
          rawResponse: result.rawResponse,
          decryptedResponse: result.decryptedResponse,
          sanitizedResponse: result.data
        }
      });
    } catch (_) {
      // non-fatal audit failure
    }

    return res.status(200).json({
      success: true,
      message: result.message,
      responseCode: result.responseCode,
      merchantRefId,
      reference_id: merchantRefId,
      payout_provider: 'Vimo',
      service_charge: serviceCharge,
      data: result.data
    });
  } catch (error) {
    try {
      await PayoutAuditLog.create({
        payout_id: payoutTransaction.id,
        action: 'VIMO_PAYOUT_FAILURE',
        details: {
          merchantRefId,
          error: {
            message: error.message,
            code: error.code || null,
            statusCode: error.statusCode || null,
            details: error.details || null,
          }
        }
      });
    } catch (_) {
      // non-fatal: keep original error handling path
    }

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

async function failProcessingPayout(req, res) {
  if (!isAdmin(req.user) && !hasPermission(req.user, EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE)) {
    return res.status(403).json({ success: false, message: 'Admin or authorized employee access required' });
  }

  const referenceId = req.body.reference_id || req.body.merchantRefId || req.body.referenceId;
  if (!referenceId) {
    return res.status(400).json({ success: false, message: 'reference_id or merchantRefId is required' });
  }

  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const pendingPayout = await PayoutTransaction.findOne({
    where: {
      reference_id: referenceId,
      payout_provider: 'Vimo',
      status: 'Processing'
    }
  });

  if (!pendingPayout) {
    return res.status(404).json({ success: false, message: 'No Vimo processing payout found for the given reference' });
  }

  if (pendingPayout.createdAt > cutoff) {
    return res.status(400).json({ success: false, message: 'Payout has not been processing for more than 10 minutes' });
  }

  const tr = await db.transaction();
  try {
    const locked = await PayoutTransaction.findByPk(pendingPayout.id, { transaction: tr, lock: tr.LOCK.UPDATE });
    if (!locked) {
      await tr.rollback();
      return res.status(404).json({ success: false, message: 'Payout transaction not found' });
    }

    if (locked.status !== 'Processing') {
      await tr.rollback();
      return res.status(409).json({ success: false, message: `Payout is not in Processing state (current=${locked.status})` });
    }

    const refundAmount = parseFloat(locked.amount || 0) + parseFloat(locked.service_charge || 0);
    const existingRefund = await Ledger.findOne({
      where: {
        transaction_type: 'payout_refund',
        reference_id: locked.id,
        reference_table: 'PayoutTransactions'
      },
      transaction: tr
    });

    const actor = {
      id: req.user.id,
      name: req.user.name || null,
      username: req.user.username || null,
      role: req.user.role || null,
    };
    const failReason = 'Manual failure enforced after 10+ minutes processing';

    locked.status = 'FAILED';
    locked.callback_status = 'FAILED';
    locked.callback_data = JSON.stringify({
      action: 'manual_fail',
      performed_by: actor,
      reason: failReason,
      timestamp: new Date().toISOString()
    });
    locked.callback_received_at = new Date();

    let existingData = {};
    if (locked.data) {
      try {
        existingData = JSON.parse(locked.data);
      } catch (_) {
        existingData = { original: locked.data };
      }
    }
    existingData.manualFailAction = {
      performed_by: actor,
      reason: failReason,
      timestamp: new Date().toISOString()
    };
    locked.data = JSON.stringify(existingData);

    await locked.save({ transaction: tr });

    if (!existingRefund && refundAmount > 0) {
      await ledgerService.createLedgerEntry({
        userId: locked.merchant_id,
        transactionType: 'payout_refund',
        referenceId: locked.id,
        referenceTable: 'PayoutTransactions',
        description: `Refund for manual-failed Vimo payout ${locked.reference_id}`,
        credit: refundAmount,
        metadata: {
          payout_reference: locked.reference_id,
          payout_provider: locked.payout_provider,
          actor_id: req.user.id,
          actor_name: req.user.name || null,
          actor_username: req.user.username || null,
          original_amount: locked.amount,
          service_charge: locked.service_charge
        }
      }, { transaction: tr });
    }

    await PayoutAuditLog.create({
      payout_id: locked.id,
      action: 'VIMO_MANUAL_FAIL_PAYOUT',
      details: {
        actor: actor,
        merchant_id: locked.merchant_id,
        reference_id: locked.reference_id,
        amount: locked.amount,
        service_charge: locked.service_charge,
        refundAmount,
        reason: failReason
      }
    }, { transaction: tr });

    await tr.commit();

    return res.status(200).json({
      success: true,
      message: 'Vimo payout marked failed and refund processed',
      reference_id: locked.reference_id,
      refundAmount
    });
  } catch (err) {
    await tr.rollback();
    const normalized = normalizeError(err);
    return res.status(normalized.statusCode || 500).json({ success: false, message: normalized.message, error: normalized });
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

async function getWalletBalance(req, res) {
  if (!req.user || (!isAdmin(req.user) && !hasPermission(req.user, EMPLOYEE_PERMISSIONS.PAYOUT_READ))) {
    return res.status(403).json({ success: false, message: 'Admin or authorized employee access required' });
  }

  try {
    const merchantRefId = await payoutReferenceService.getNextPayoutReference({ provider: 'vimo', userId: req.user?.id });
    const result = await vimoService.fetchWalletBalance(merchantRefId);
    return res.status(200).json({
      success: true,
      message: result.message,
      responseCode: result.responseCode,
      merchantRefId,
      data: result.data,
    });
  } catch (error) {
    const normalized = normalizeError(error);
    return res.status(normalized.statusCode || 500).json({
      success: false,
      message: normalized.message,
      error: normalized,
    });
  }
}

async function getPayoutReference(req, res) {
  try {
    const reference = await payoutReferenceService.getNextPayoutReference({ provider: 'vimo', userId: req.user?.id });
    return res.status(200).json({ success: true, merchantRefId: reference });
  } catch (err) {
    const normalized = normalizeError(err, { statusCode: 500, message: 'Could not generate merchantRefId', code: 'REFERENCE_GENERATION_FAILED' });
    return res.status(normalized.statusCode || 500).json({ success: false, message: normalized.message, error: normalized });
  }
}

async function getPayoutAuditLogsByReference(req, res) {
  try {
    if (!req.user || (!isAdmin(req.user) && !hasPermission(req.user, EMPLOYEE_PERMISSIONS.PAYOUT_READ))) {
      return res.status(403).json({ success: false, message: 'Admin or authorized employee access required' });
    }

    const referenceId = req.query.reference_id || req.query.merchantRefId || req.query.referenceId;
    if (!referenceId) {
      return res.status(400).json({ success: false, message: 'reference_id or merchantRefId is required' });
    }

    const payoutTransaction = await PayoutTransaction.findOne({
      where: {
        reference_id: referenceId,
        payout_provider: 'Vimo'
      }
    });

    if (!payoutTransaction) {
      return res.status(404).json({ success: false, message: 'No Vimo payout transaction found for the given reference id' });
    }

    const logs = await PayoutAuditLog.findAll({
      where: { payout_id: payoutTransaction.id },
      order: [['created_at', 'ASC']]
    });

    return res.status(200).json({
      success: true,
      message: 'Vimo payout audit logs retrieved successfully',
      payout_id: payoutTransaction.id,
      reference_id: payoutTransaction.reference_id,
      totalLogs: logs.length,
      data: logs
    });
  } catch (error) {
    console.error('Get Vimo payout audit logs by reference error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
}

async function handleCallback(req, res) {
  const payload = req.body;
  const receivedAt = new Date().toISOString();
  const sourceIp = req.ip || req.connection?.remoteAddress;

  vimoCallbackLog('INFO', '--- Vimo callback received ---', { receivedAt, ip: sourceIp, payload });

  // ── DB: persist raw payload immediately (outside transaction) ─────────────
  // This guarantees we always have the raw inbound data even if processing fails.
  try {
    await PayoutWebhookLog.create({ payload, source_ip: sourceIp });
  } catch (logErr) {
    vimoCallbackLog('WARN', 'PayoutWebhookLog.create failed (non-fatal)', { message: logErr.message, payload });
  }

  // Always respond 200 immediately so Vimo doesn't retry.
  res.status(200).json({ successStatus: true, message: 'Success', responseCode: '000' });
  vimoCallbackLog('INFO', 'Vimo callback response sent, background processing scheduled');

  // Process in background after response is sent.
  setImmediate(async () => {
    vimoCallbackLog('INFO', 'Vimo callback background processing started');
    try {
      const merchantRefId = payload.merchantRefId || payload.merchant_ref_id || payload.referenceId;
      const vimoStatus   = (payload.status || payload.txnStatus || '').toUpperCase();
      const utrValue     = payload.utr || payload.bankRefNo || null;

      vimoCallbackLog('INFO', 'Parsed callback fields', { merchantRefId, vimoStatus });
      vimoCallbackLog('DEBUG', 'Vimo callback payload mapping values', {
        merchantRefId,
        vimoStatus,
        utr: utrValue,
        rawStatus: payload.status,
        rawTxnStatus: payload.txnStatus,
        rawReference: payload.referenceId,
        rawMerchantRefId: payload.merchantRefId,
        rawMerchantRefIdAlt: payload.merchant_ref_id,
      });

      if (!merchantRefId) {
        vimoCallbackLog('WARN', 'No merchantRefId in payload — skipping processing');
        return;
      }

      const TERMINAL = ['SUCCESS', 'FAILED', 'REVERSED', 'CANCELLED'];

      // ── Open transaction FIRST, then lock the row ──────────────────────────
      const tr = await db.transaction();
      vimoCallbackLog('INFO', `DB transaction opened for ref: ${merchantRefId}`);
      try {
        const txn = await PayoutTransaction.findOne({
          where: { reference_id: merchantRefId },
          transaction: tr,
          lock: tr.LOCK.UPDATE,
        });

        if (!txn) {
          await tr.commit();
          vimoCallbackLog('WARN', `No PayoutTransaction found for ref: ${merchantRefId} — nothing to update`);
          return;
        }

        vimoCallbackLog('INFO', `Found PayoutTransaction`, { id: txn.id, currentStatus: txn.status, amount: txn.amount, service_charge: txn.service_charge, merchant_id: txn.merchant_id });

        try {
          await PayoutAuditLog.create({
            payout_id: txn.id,
            action: 'VIMO_CALLBACK_RECEIVED',
            details: {
              merchantRefId,
              source_ip: sourceIp,
              receivedAt,
              callbackPayload: payload
            }
          }, { transaction: tr });
        } catch (auditErr) {
          vimoCallbackLog('WARN', 'Failed to save Vimo callback audit log', { message: auditErr.message, merchantRefId });
        }

        // Terminal check inside the lock.
        if (TERMINAL.includes((txn.status || '').toUpperCase())) {
          await PayoutAuditLog.create({
            payout_id: txn.id,
            action: 'VIMO_SKIP_TERMINAL',
            details: { merchantRefId, vimoStatus, currentStatus: txn.status, reason: 'Already in terminal state' }
          }, { transaction: tr });
          await tr.commit();
          vimoCallbackLog('INFO', `Transaction ${merchantRefId} already terminal (${txn.status}) — skipping update`);
          return;
        }

        // Map Vimo status to internal status.
        let newStatus = 'Processing';
        if (['SUCCESS', 'TRANSFERRED'].includes(vimoStatus)) newStatus = 'SUCCESS';
        else if (['FAILED', 'FAILURE', 'REJECTED', 'REVERSED', 'CANCELLED'].includes(vimoStatus)) newStatus = 'FAILED';

        vimoCallbackLog('INFO', `Status mapping: vimo=${vimoStatus} → internal=${newStatus}`);

        const previousStatus = txn.status;
        txn.status = newStatus;

        let existing = {};
        if (txn.data) {
          try {
            existing = JSON.parse(txn.data);
          } catch (parseErr) {
            existing = { original: txn.data };
            vimoCallbackLog('WARN', 'Existing txn.data is not JSON, preserving raw data', { parseError: parseErr.message });
          }
        }

        existing.callback = payload;
        if (payload.utr || payload.bankRefNo) {
          existing.utr = payload.utr || payload.bankRefNo;
          vimoCallbackLog('INFO', `UTR/bankRefNo stored`, { utr: payload.utr || payload.bankRefNo });
        }
        txn.data = JSON.stringify(existing);
        txn.callback_status = newStatus;
        txn.callback_data = JSON.stringify(payload);
        txn.callback_received_at = new Date();

        await txn.save({ transaction: tr });
        vimoCallbackLog('INFO', `PayoutTransaction ${txn.id} status updated to ${newStatus}`);

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
            callback: payload,
          }
        }, { transaction: tr });

        vimoLog('INFO', 'Ledger payout debit remains immutable; callback will add refund entry only on failure');

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
            vimoCallbackLog('WARN', `Refund already exists for PayoutTransaction ${txn.id} (Ledger id=${existingRefund.id}) — duplicate refund blocked`);
            // ── DB audit: duplicate refund blocked ────────────────────────
            await PayoutAuditLog.create({
              payout_id: txn.id,
              action: 'VIMO_REFUND_BLOCKED',
              details: { merchantRefId, existingLedgerId: existingRefund.id, reason: 'Duplicate refund prevented' }
            }, { transaction: tr });
          } else {
            const refundAmount = parseFloat(txn.amount || 0) + parseFloat(txn.service_charge || 0);
            vimoCallbackLog('INFO', `Issuing refund credit`, { merchant_id: txn.merchant_id, refundAmount });
            await ledgerService.createLedgerEntry({
              userId: txn.merchant_id,
              transactionType: 'payout_refund',
              referenceId: txn.id,
              referenceTable: 'PayoutTransactions',
              description: `Refund for failed Vimo payout ${merchantRefId}`,
              credit: refundAmount,
            }, { transaction: tr });
            vimoCallbackLog('INFO', `Refund credit created for merchant ${txn.merchant_id}, amount ₹${refundAmount}`);
            // ── DB audit: refund issued ────────────────────────────────────
            await PayoutAuditLog.create({
              payout_id: txn.id,
              action: 'VIMO_REFUND_ISSUED',
              details: { merchantRefId, merchant_id: txn.merchant_id, refundAmount, amount: txn.amount, service_charge: txn.service_charge }
            }, { transaction: tr });
          }
        }

        await tr.commit();
        vimoCallbackLog('INFO', `DB transaction committed — ref: ${merchantRefId} finalised as ${newStatus}`);
      } catch (err) {
        await tr.rollback();
        vimoCallbackLog('ERROR', `DB error — transaction rolled back for ref: ${merchantRefId}`, { message: err.message, stack: err.stack });
      }
    } catch (err) {
      vimoCallbackLog('ERROR', 'Unexpected error in handleCallback background processing', { message: err.message, stack: err.stack });
    }
  });
}

// Vimo beneficiary management
async function createBeneficiary(req, res) {
  const { name, account_number, ifsc_code, bank_name, bank_code, branch_name, state, mobile, email } = req.body;
  const userId = req.user?.id;

  if (!userId || !name || !account_number || !ifsc_code || !bank_name || !state) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const beneficiary = await Beneficiary.create({
    merchant_id:      userId,
    beneficiary_name: name,
    account_number,
    ifsc_code,
    bank_name,
    bank_code:      bank_code || null,
    branch_name:   branch_name || null,
    state,
    mobile_number: mobile || '',
    email:         email || '',
    status:        'active',
  });

  return res.status(201).json({ success: true, data: beneficiary });
}

async function listBeneficiaries(req, res) {
  const userIdFromToken = req.user?.id;

  if (!userIdFromToken) {
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  const list = await Beneficiary.findAll({ where: { merchant_id: userIdFromToken } });
  return res.status(200).json({ success: true, data: list });
}

async function updateBeneficiary(req, res) {
  const id = req.params.id;
  const beneficiary = await Beneficiary.findByPk(id);

  if (!beneficiary) {
    return res.status(404).json({ success: false, message: 'Beneficiary not found' });
  }

  await beneficiary.update(req.body);
  return res.status(200).json({ success: true, data: beneficiary });
}

async function deleteBeneficiary(req, res) {
  const id = req.params.id;
  const beneficiary = await Beneficiary.findByPk(id);

  if (!beneficiary) {
    return res.status(404).json({ success: false, message: 'Beneficiary not found' });
  }

  await beneficiary.update({ status: 'inactive' });
  return res.status(200).json({ success: true, message: 'Beneficiary deleted successfully' });
}

async function checkPayoutStatus(req, res) {
  try {
    const merchantRefId = req.params.merchantRefId || req.query.merchantRefId || req.body.merchantRefId;
    const txnId = req.query.txnId || req.body.txnId;

    if (!merchantRefId && !txnId) {
      return res.status(400).json({ success: false, message: 'merchantRefId or txnId is required' });
    }

    const result = await vimoService.checkPayoutStatus({ merchantRefId, txnId });
    return res.status(200).json({
      success: true,
      message: result.message,
      responseCode: result.responseCode,
      data: result.data,
      rawResponse: result.rawResponse,
      decryptedResponse: result.decryptedResponse,
    });
  } catch (error) {
    const normalized = normalizeError(error, {
      statusCode: 502,
      message: 'Failed to fetch payout status',
      code: 'PAYOUT_STATUS_ERROR'
    });
    return res.status(normalized.statusCode || 500).json({
      success: false,
      message: normalized.message,
      error: normalized
    });
  }
}

module.exports = {
  createPayout,
  checkPayoutStatus,
  fetchTokenStatus,
  fetchBankList,
  fetchPurposeList,
  fetchStateList,
  getWalletBalance,
  getPayoutReference,
  getPayoutAuditLogsByReference,
  handleCallback,
  failProcessingPayout,
  createBeneficiary,
  listBeneficiaries,
  updateBeneficiary,
  deleteBeneficiary
};

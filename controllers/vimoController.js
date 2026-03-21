const vimoService = require('../services/vimo.service');
const User = require('../models/User');
const PayoutBeneficiary = require('../models/PayoutBeneficiary');

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
const ledgerService = require('../services/ledgerService');
const db = require('../config/database');

const callbackEvents = [];

async function createPayout(req, res) {
  const {
    user_id,
    amount: rawAmount,
    service_charge = 0,
    beneficiary_id,
    beneficiaryBank,
    beneficiaryAccountNumber,
    beneficiaryIFSC,
    beneficiaryMobileNumber,
    beneficiaryName,
    beneficiaryLocation,
    paymentPurpose,
    paymentMode,
    merchantRefId,
    tpin,
    purpose,
    latitude,
    longitude
  } = req.body;

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
  const resolvedBeneficiaryLocation = beneficiaryLocation || selectedBeneficiary?.branch_name || null;

  if (!resolvedBeneficiaryBank || !resolvedBeneficiaryAccountNumber || !resolvedBeneficiaryIFSC || !resolvedBeneficiaryName) {
    return res.status(400).json({ success: false, message: 'Beneficiary information missing' });
  }

  if (!user_id) {
    return res.status(400).json({ success: false, message: 'user_id is required' });
  }

  if (!tpin) {
    return res.status(400).json({ success: false, message: 'tpin is required' });
  }

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

  const total_amount = amount + parseFloat(service_charge || 0);

  if (parseFloat(user.wallet) < total_amount) {
    return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
  }

  const transaction = await db.transaction();
  try {
    // wallet deduction in ledger, will sync balance
    const payoutTransaction = await PayoutTransaction.create({
      merchant_id: user_id,
      beneficiary_id: null,
      reference_id: merchantRefId || null,
      amount: amount,
      status: 'PENDING',
      purpose: purpose || paymentPurpose || null,
      data: null,
      service_charge: service_charge
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
        latitude,
        longitude
      }
    }, { transaction });

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    return sendFailure(res, normalizeError(err));
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
      latitude,
      longitude,
      tpin,
      purpose
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      responseCode: result.responseCode,
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

async function fetchTokenStatus(req, res) {
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

function handleCallback(req, res) {
  const callbackEvent = {
    receivedAt: new Date().toISOString(),
    payload: req.body,
  };

  callbackEvents.push(callbackEvent);
  console.log('Vimo callback received:', callbackEvent);

  return res.status(200).json({
    successStatus: true,
    message: 'Success',
    responseCode: '000'
  });
}

module.exports = {
  createPayout,
  fetchTokenStatus,
  fetchBankList,
  fetchPurposeList,
  fetchStateList,
  handleCallback
};

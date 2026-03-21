const { sendFailure, sendSuccess } = require('../utils/response');
const { normalizeError } = require('../utils/errors');
const vimoService = require('../services/vimo.service');
const User = require('../models/User');
const PayoutTransaction = require('../models/PayoutTransaction');
const ledgerService = require('../services/ledgerService');
const db = require('../config/database');

const callbackEvents = [];

async function createPayout(req, res) {
  const {
    user_id,
    amount: rawAmount,
    service_charge = 0,
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

  if (!user_id) {
    return sendFailure(res, { statusCode: 400, message: 'user_id is required' });
  }

  if (!tpin) {
    return sendFailure(res, { statusCode: 400, message: 'tpin is required' });
  }

  const user = await User.findByPk(user_id);
  if (!user) {
    return sendFailure(res, { statusCode: 404, message: 'User not found' });
  }

  if (!user.is_payout_enabled) {
    return sendFailure(res, { statusCode: 403, message: 'Payout service is disabled for this user' });
  }

  const amount = parseFloat(rawAmount);
  if (!amount || isNaN(amount) || amount <= 0) {
    return sendFailure(res, { statusCode: 400, message: 'Invalid payout amount' });
  }

  const total_amount = amount + parseFloat(service_charge || 0);

  if (parseFloat(user.wallet) < total_amount) {
    return sendFailure(res, { statusCode: 400, message: 'Insufficient wallet balance' });
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
        beneficiaryBank,
        beneficiaryAccountNumber,
        beneficiaryIFSC,
        beneficiaryMobileNumber,
        beneficiaryName,
        beneficiaryLocation,
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
      beneficiaryBank,
      paymentPurpose,
      paymentMode,
      beneficiaryAccountNumber,
      beneficiaryIFSC,
      beneficiaryMobileNumber,
      beneficiaryName,
      beneficiaryLocation,
      latitude,
      longitude,
      tpin,
      purpose
    });

    return sendSuccess(res, {
      message: result.message,
      responseCode: result.responseCode,
      data: result.data
    });
  } catch (error) {
    // NOTE: we choose not to rollback ledger here; a separate job/webhook should settle
    console.error('Vimo payout failed', error);
    return sendFailure(res, normalizeError(error));
  }
}

async function fetchTokenStatus(req, res) {
  try {
    const authorizeResponse = await vimoService.getAuthorizeTokenResponse({
      forceRefresh: req.query.forceRefresh === 'true'
    });
    return sendSuccess(res, {
      message: authorizeResponse.message || 'Token status fetched',
      responseCode: authorizeResponse.responseCode || '000',
      data: authorizeResponse.data || authorizeResponse
    });
  } catch (error) {
    return sendFailure(res, normalizeError(error, {
      statusCode: 502,
      message: 'Token generation failure',
      code: 'TOKEN_GENERATION_FAILED'
    }));
  }
}

async function fetchBankList(req, res) {
  try {
    const result = await vimoService.fetchBankList();
    return sendSuccess(res, {
      message: result.message,
      responseCode: result.responseCode,
      data: result.data
    });
  } catch (error) {
    return sendFailure(res, normalizeError(error, {
      statusCode: 502,
      message: 'Failed to fetch bank list',
      code: 'BANK_API_ERROR'
    }));
  }
}

async function fetchPurposeList(req, res) {
  try {
    const result = await vimoService.fetchPurposeList();
    return sendSuccess(res, {
      message: result.message,
      responseCode: result.responseCode,
      data: result.data
    });
  } catch (error) {
    return sendFailure(res, normalizeError(error, {
      statusCode: 502,
      message: 'Failed to fetch purpose list',
      code: 'BANK_API_ERROR'
    }));
  }
}

async function fetchStateList(req, res) {
  try {
    const result = await vimoService.fetchStateList();
    return sendSuccess(res, {
      message: result.message,
      responseCode: result.responseCode,
      data: result.data
    });
  } catch (error) {
    return sendFailure(res, normalizeError(error, {
      statusCode: 502,
      message: 'Failed to fetch state list',
      code: 'BANK_API_ERROR'
    }));
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

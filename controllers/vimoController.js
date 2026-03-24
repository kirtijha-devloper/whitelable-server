const vimoService = require('../services/vimo.service');
const User = require('../models/User');
const PayoutBeneficiary = require('../models/PayoutBeneficiary');
const { Op } = require('sequelize');

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

  // enforce/generate merchantRefId for idempotency and duplicate prevention
  if (!merchantRefId) {
    merchantRefId = await generateMerchantRefId();
  } else {
    const existingReference = await PayoutTransaction.findOne({ where: { reference_id: merchantRefId } });
    if (existingReference) {
      return res.status(409).json({ success: false, message: 'Duplicate merchantRefId', error: { code: 'DUPLICATE_REFERENCE', details: 'merchantRefId already used' } });
    }
  }

  const amount = parseFloat(rawAmount);
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid payout amount' });
  }

  // Service charge controlled by backend configuration
  const serviceCharge = parseFloat(process.env.VIMO_DEFAULT_SERVICE_CHARGE || 0);
  const total_amount = amount + serviceCharge;
  const transaction = await db.transaction();
  try {
    // wallet deduction in ledger, will sync balance
    const payoutTransaction = await PayoutTransaction.create({
      merchant_id: user_id,
      beneficiary_id: beneficiary_id || null,
      reference_id: merchantRefId || null,
      amount: amount,
      status: 'PENDING',
      purpose: purpose || paymentPurpose || null,
      data: null,
      service_charge: serviceCharge
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

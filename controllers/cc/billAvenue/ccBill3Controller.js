const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const BillAvenueBillFetch = require('../../../models/BillAvenueBillFetch');
const BillAvenuePayment = require('../../../models/BillAvenuePayment');
const PayoutTransaction = require('../../../models/PayoutTransaction');
const PayoutAuditLog = require('../../../models/PayoutAuditLog');
const PayoutCharge = require('../../../models/PayoutCharge');
const Beneficiary = require('../../../models/Beneficiary');
const User = require('../../../models/User');
const ledgerService = require('../../../services/ledgerService');
const payoutReferenceService = require('../../../services/payoutReferenceService');
const vimoService = require('../../../services/vimo.service');
const db = require('../../../config/database');
const {
  SERVICE_SETTING_KEYS,
  assertServiceEnabledOrRespond,
} = require('../../../services/serviceSettingsService');

const SUPPORTED_CC_BANKS = [
  {
    key: 'hdfc',
    label: 'HDFC BANK',
    bankName: 'HDFC Bank',
    ifsc: 'HDFC0000128',
    matchers: ['hdfc', 'hdfc bank'],
  },
  {
    key: 'idfc',
    label: 'IDFC FIRST BANK',
    bankName: 'IDFC FIRST Bank',
    ifsc: 'IDFB0010225',
    matchers: ['idfc', 'idfc first', 'idfc first bank'],
  },
  {
    key: 'yes',
    label: 'YES BANK',
    bankName: 'YES Bank',
    ifsc: 'YESB0CMSNOC',
    matchers: ['yes', 'yes bank'],
  },
  {
    key: 'kotak',
    label: 'KOTAK MAHINDRA BANK',
    bankName: 'Kotak Mahindra Bank',
    ifsc: 'KKBK0000958',
    matchers: ['kotak', 'kotak mahindra', 'kotak mahindra bank'],
  },
];

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function safeParseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function resolveSupportedBank({ bankName, billerId }) {
  const candidates = [bankName, billerId]
    .filter(Boolean)
    .map((value) => normalizeText(value));

  for (const bank of SUPPORTED_CC_BANKS) {
    if (candidates.some((candidate) => bank.matchers.some((matcher) => candidate.includes(matcher)))) {
      return bank;
    }
  }

  return null;
}

function extractCustomerMobile(customerParams, fallbackMobile) {
  if (Array.isArray(customerParams)) {
    const match = customerParams.find((item) =>
      normalizeText(item?.name).includes('mobile') && String(item?.value || '').trim());
    if (match) return String(match.value).trim();
  }

  if (customerParams && typeof customerParams === 'object') {
    const entry = Object.entries(customerParams).find(([key, value]) =>
      normalizeText(key).includes('mobile') && String(value || '').trim());
    if (entry) return String(entry[1]).trim();
  }

  return String(fallbackMobile || '9999999999').trim();
}

function extractBeneficiaryAccountNumber(customerParams, explicitValue) {
  if (explicitValue) {
    return String(explicitValue).trim();
  }

  if (Array.isArray(customerParams)) {
    const firstValue = customerParams.find((item) => String(item?.value || '').trim());
    if (firstValue) return String(firstValue.value).trim();
  }

  if (customerParams && typeof customerParams === 'object') {
    const firstEntry = Object.entries(customerParams).find(([, value]) => String(value || '').trim());
    if (firstEntry) return String(firstEntry[1]).trim();
  }

  return '';
}

async function findOrCreateCcBill3Beneficiary({
  userId,
  accountNumber,
  ifsc,
  bankName,
  beneficiaryName,
  mobileNumber,
  state,
}) {
  const existing = await Beneficiary.findOne({
    where: {
      merchant_id: userId,
      account_number: accountNumber,
      ifsc_code: ifsc,
    },
  });

  if (existing) {
    const updates = {};
    if (!existing.bank_name && bankName) updates.bank_name = bankName;
    if (!existing.beneficiary_name && beneficiaryName) updates.beneficiary_name = beneficiaryName;
    if (!existing.mobile_number && mobileNumber) updates.mobile_number = mobileNumber;
    if (!existing.state && state) updates.state = state;

    if (Object.keys(updates).length > 0) {
      await existing.update(updates);
    }

    return existing;
  }

  return Beneficiary.create({
    merchant_id: userId,
    mobile_number: mobileNumber || '9999999999',
    bank_name: bankName,
    account_number: accountNumber,
    beneficiary_name: beneficiaryName,
    ifsc_code: ifsc,
    email: '',
    state: state || null,
    status: 'active',
  });
}

async function resolvePayoutServiceCharge(payoutAmount) {
  const rule = await PayoutCharge.findOne({
    where: {
      is_active: true,
      from_amount: { [Op.lte]: payoutAmount },
      to_amount: { [Op.gte]: payoutAmount },
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

    return {
      charge: +charge.toFixed(2),
      slabId: rule.id,
      rate: parseFloat(rule.rate),
      rateType: rule.rate_type,
      source: 'db',
    };
  }

  const envCharge = parseFloat(process.env.VIMO_DEFAULT_SERVICE_CHARGE || 0);
  return {
    charge: +envCharge.toFixed(2),
    slabId: null,
    rate: envCharge,
    rateType: 'flat',
    source: 'env',
  };
}

const getSupportedBanks = asyncHandler(async (_req, res) => {
  return res.status(200).json({
    success: true,
    data: SUPPORTED_CC_BANKS.map((bank) => ({
      key: bank.key,
      label: bank.label,
      bankName: bank.bankName,
      ifsc: bank.ifsc,
    })),
  });
});

async function executeCcBill3Payment(req, res, options = {}) {
  const {
    bypassVimoUserServiceCheck = false,
  } = options;

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const user = await User.findByPk(userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (!(await assertServiceEnabledOrRespond(res, SERVICE_SETTING_KEYS.CC_BILL_3, req.user))) {
    return;
  }

  if (!bypassVimoUserServiceCheck && !(await assertServiceEnabledOrRespond(res, SERVICE_SETTING_KEYS.VIMO_PAYOUT, user))) {
    return;
  }

  const {
    fetchId,
    billerId: bodyBillerId,
    customerParams: bodyCustomerParams,
    amount: bodyAmount,
    bankName,
    beneficiaryAccountNumber,
    beneficiaryMobileNumber,
    beneficiaryName,
    beneficiaryLocation,
    lat,
    long,
    paymentMode,
    paymentPurpose,
    purpose,
  } = req.body;

  let fetchRecord = null;
  if (fetchId) {
    fetchRecord = await BillAvenueBillFetch.findByPk(fetchId);
    if (!fetchRecord) {
      return res.status(404).json({ success: false, message: 'Bill fetch record not found' });
    }
    if (req.user?.role !== 'admin' && fetchRecord.user_id !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
  }

  const finalBillerId = fetchRecord?.biller_id || bodyBillerId;
  const finalCustomerParams = fetchRecord?.customer_params || bodyCustomerParams;
  const finalAmount = parseFloat(fetchRecord?.amount || bodyAmount);

  if (!finalBillerId || !finalCustomerParams || Number.isNaN(finalAmount) || finalAmount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Required: fetchId or (billerId, customerParams, amount)',
    });
  }

  const bank = resolveSupportedBank({ bankName, billerId: finalBillerId });
  if (!bank) {
    return res.status(400).json({
      success: false,
      message: 'Unsupported CC bank. Supported banks are HDFC, IDFC FIRST, YES, and KOTAK MAHINDRA.',
      supportedBanks: SUPPORTED_CC_BANKS.map((item) => item.label),
    });
  }

  const resolvedBeneficiaryAccountNumber = extractBeneficiaryAccountNumber(finalCustomerParams, beneficiaryAccountNumber);
  if (!resolvedBeneficiaryAccountNumber) {
    return res.status(400).json({
      success: false,
      message: 'beneficiaryAccountNumber could not be resolved from the fetched bill. Send it explicitly from frontend.',
    });
  }

  const resolvedBeneficiaryMobile = extractCustomerMobile(finalCustomerParams, beneficiaryMobileNumber || user.mobile_number);
  const resolvedBeneficiaryName = String(beneficiaryName || `${bank.label} CC BILL`).trim();
  const resolvedBeneficiaryLocation = String(beneficiaryLocation || user.state || '').trim();
  if (!resolvedBeneficiaryLocation) {
    return res.status(400).json({
      success: false,
      message: 'beneficiaryLocation is required for Vimo. Send a state code from frontend or update the user state.',
    });
  }

  if (lat === undefined || lat === null || long === undefined || long === null) {
    return res.status(400).json({
      success: false,
      message: 'lat and long are required for CC Bill 3 Vimo payout.',
    });
  }

  const resolvedBankCode = await vimoService.resolveBankCode(bank.bankName);
  if (!resolvedBankCode) {
    return res.status(400).json({
      success: false,
      message: `Unable to resolve Vimo bank code for ${bank.bankName}.`,
    });
  }

  const payoutBeneficiary = await findOrCreateCcBill3Beneficiary({
    userId,
    accountNumber: resolvedBeneficiaryAccountNumber,
    ifsc: bank.ifsc,
    bankName: bank.bankName,
    beneficiaryName: resolvedBeneficiaryName,
    mobileNumber: resolvedBeneficiaryMobile,
    state: resolvedBeneficiaryLocation,
  });

  const chargeResolution = await resolvePayoutServiceCharge(finalAmount);
  const serviceCharge = chargeResolution.charge;
  const totalAmount = +(finalAmount + serviceCharge).toFixed(2);
  const availableBalance = await ledgerService.getAvailableBalance(userId);

  if (availableBalance < totalAmount) {
    return res.status(400).json({
      success: false,
      message: `Insufficient balance. Available: Rs.${availableBalance.toFixed(2)}, Required: Rs.${totalAmount.toFixed(2)}`,
      availableBalance,
      requiredBalance: totalAmount,
      serviceCharge,
    });
  }

  const merchantRefId = await payoutReferenceService.getNextPayoutReference({ provider: 'vimo', userId });
  const resolvedPaymentPurpose = String(paymentPurpose || purpose || process.env.VIMO_CC_BILL_PAYMENT_PURPOSE || 'UTILITY').trim();
  const resolvedPaymentMode = String(paymentMode || process.env.VIMO_CC_BILL_PAYMENT_MODE || 'IMPS').trim();

  const transaction = await db.transaction();
  let payment;
  let payoutTransaction;

  try {
    payment = await BillAvenuePayment.create({
      user_id: userId,
      biller_id: finalBillerId,
      customer_params: finalCustomerParams,
      transaction_amount: finalAmount,
      payment_mode: resolvedPaymentMode,
      transaction_ref_id: merchantRefId,
      status: 'processing',
      response_code: 'VIMO_PENDING',
      response: {
        source: 'ba_cc_bill_3',
        fetchId: fetchRecord?.id || null,
        merchantRefId,
        vimo: {
          status: 'PROCESSING',
          bankName: bank.bankName,
          ifsc: bank.ifsc,
          serviceCharge,
        },
      },
      charge_amount: serviceCharge,
    }, { transaction });

    payoutTransaction = await PayoutTransaction.create({
      merchant_id: userId,
      beneficiary_id: payoutBeneficiary.id,
      reference_id: merchantRefId,
      payout_provider: 'Vimo',
      amount: finalAmount,
      status: 'Processing',
      purpose: resolvedPaymentPurpose,
      data: JSON.stringify({
        source: 'ba_cc_bill_3',
        billAvenuePaymentId: payment.id,
        billFetchId: fetchRecord?.id || null,
        billerId: finalBillerId,
        beneficiaryId: payoutBeneficiary.id,
        beneficiaryAccountNumber: resolvedBeneficiaryAccountNumber,
        beneficiaryIFSC: bank.ifsc,
        beneficiaryBank: bank.bankName,
        beneficiaryName: resolvedBeneficiaryName,
      }),
      service_charge: serviceCharge,
    }, { transaction });

    await PayoutAuditLog.create({
      payout_id: payoutTransaction.id,
      action: 'BA_CC_BILL_3_INIT',
      details: {
        merchantRefId,
        billAvenuePaymentId: payment.id,
        billFetchId: fetchRecord?.id || null,
        billerId: finalBillerId,
        transactionAmount: finalAmount,
        serviceCharge,
        chargeSource: chargeResolution.source,
        chargeSlabId: chargeResolution.slabId,
        beneficiaryId: payoutBeneficiary.id,
        beneficiaryBank: bank.bankName,
        beneficiaryIFSC: bank.ifsc,
      },
    }, { transaction });

    await ledgerService.createPayoutEntry({
      userId,
      payoutTransactionId: payoutTransaction.id,
      amount: totalAmount,
      description: `CC Bill 3 via Vimo ${merchantRefId}`,
      metadata: {
        source: 'ba_cc_bill_3',
        billAvenuePaymentId: payment.id,
        billFetchId: fetchRecord?.id || null,
        billerId: finalBillerId,
        beneficiaryId: payoutBeneficiary.id,
        beneficiaryBank: bank.bankName,
        beneficiaryIFSC: bank.ifsc,
        serviceCharge,
      },
    }, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  try {
    const result = await vimoService.createPayout({
      amount: finalAmount,
      merchantRefId,
      beneficiaryBank: resolvedBankCode,
      paymentPurpose: resolvedPaymentPurpose,
      paymentMode: resolvedPaymentMode,
      beneficiaryAccountNumber: resolvedBeneficiaryAccountNumber,
      beneficiaryIFSC: bank.ifsc,
      beneficiaryMobileNumber: resolvedBeneficiaryMobile,
      beneficiaryName: resolvedBeneficiaryName,
      beneficiaryLocation: resolvedBeneficiaryLocation,
      lat: String(lat),
      long: String(long),
      udf1: 'BA_CC_BILL_3',
      udf2: String(payment.id),
      udf3: String(fetchRecord?.id || ''),
    });

    const existingData = safeParseJson(payoutTransaction.data, {});
    await payoutTransaction.update({
      data: JSON.stringify({
        ...existingData,
        vimoRequestAcceptedAt: new Date().toISOString(),
        vimoInitResponse: result.data,
      }),
    });

    await payment.update({
      response: {
        ...(safeParseJson(payment.response, {}) || {}),
        vimo: {
          status: 'PROCESSING',
          responseCode: result.responseCode,
          message: result.message,
          data: result.data,
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: 'CC Bill 3 payment initiated. Wait for Vimo callback.',
      status: 'processing',
      paymentId: payment.id,
      merchantRefId,
      serviceCharge,
      totalAmount,
      data: {
        billAvenuePaymentId: payment.id,
        payoutTransactionId: payoutTransaction.id,
        vimo: result.data,
      },
    });
  } catch (error) {
    const refundAmount = +(finalAmount + serviceCharge).toFixed(2);

    await db.transaction(async (refundTransaction) => {
      const lockedPayout = await PayoutTransaction.findByPk(payoutTransaction.id, {
        transaction: refundTransaction,
        lock: refundTransaction.LOCK.UPDATE,
      });

      if (lockedPayout) {
        const currentData = safeParseJson(lockedPayout.data, {});
        lockedPayout.status = 'FAILED';
        lockedPayout.callback_status = 'FAILED';
        lockedPayout.callback_received_at = new Date();
        lockedPayout.callback_data = JSON.stringify({
          source: 'ba_cc_bill_3_init_failure',
          message: error.message,
          code: error.code || null,
          details: error.details || null,
        });
        lockedPayout.data = JSON.stringify({
          ...currentData,
          initError: {
            message: error.message,
            code: error.code || null,
            details: error.details || null,
          },
        });
        await lockedPayout.save({ transaction: refundTransaction });
      }

      await ledgerService.createLedgerEntry({
        userId,
        transactionType: 'payout_refund',
        referenceId: payoutTransaction.id,
        referenceTable: 'PayoutTransactions',
        description: `Refund for failed CC Bill 3 payout ${merchantRefId}`,
        credit: refundAmount,
      }, { transaction: refundTransaction });

      await payment.update({
        status: 'failed',
        response_code: 'VIMO_INIT_FAILED',
        response: {
          ...(safeParseJson(payment.response, {}) || {}),
          vimo: {
            status: 'FAILED',
            message: error.message,
            code: error.code || null,
            details: error.details || null,
          },
        },
      }, { transaction: refundTransaction });

      await PayoutAuditLog.create({
        payout_id: payoutTransaction.id,
        action: 'BA_CC_BILL_3_INIT_FAILED',
        details: {
          merchantRefId,
          billAvenuePaymentId: payment.id,
          error: {
            message: error.message,
            code: error.code || null,
            details: error.details || null,
          },
          refundAmount,
        },
      }, { transaction: refundTransaction });
    });

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to initiate CC Bill 3 payout',
      error: {
        code: error.code || 'VIMO_INIT_FAILED',
        details: error.details || null,
      },
    });
  }
}

const payCcBill3 = asyncHandler(async (req, res) => {
  return executeCcBill3Payment(req, res, { bypassVimoUserServiceCheck: false });
});

const payCcBill3IgnoringVimoToggle = asyncHandler(async (req, res) => {
  return executeCcBill3Payment(req, res, { bypassVimoUserServiceCheck: true });
});

const getCcBill3Status = asyncHandler(async (req, res) => {
  const payment = await BillAvenuePayment.findByPk(req.params.id);
  if (!payment) {
    return res.status(404).json({ success: false, message: 'CC Bill 3 payment record not found' });
  }

  if (req.user?.role !== 'admin' && payment.user_id !== req.user?.id) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const payoutTransaction = payment.transaction_ref_id
    ? await PayoutTransaction.findOne({ where: { reference_id: payment.transaction_ref_id } })
    : null;

  return res.status(200).json({
    success: true,
    data: {
      id: payment.id,
      status: payment.status,
      responseCode: payment.response_code,
      transactionRefId: payment.transaction_ref_id,
      transactionAmount: payment.transaction_amount,
      serviceCharge: payment.charge_amount,
      response: payment.response,
      payout: payoutTransaction
        ? {
            id: payoutTransaction.id,
            status: payoutTransaction.status,
            callbackStatus: payoutTransaction.callback_status,
            callbackReceivedAt: payoutTransaction.callback_received_at,
            data: safeParseJson(payoutTransaction.data, payoutTransaction.data),
          }
        : null,
    },
  });
});

module.exports = {
  getSupportedBanks,
  payCcBill3,
  payCcBill3IgnoringVimoToggle,
  getCcBill3Status,
};

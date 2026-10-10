const asyncHandler = require('express-async-handler');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const bbpsCCBillService = require('../../../services/cc/bbps/bbpsCCBillService');
const CcBillPayment = require('../../../models/CcBillPayment');
const Ledger = require('../../../models/Ledger');
const BbpsCcChargeRule = require('../../../models/BbpsCcChargeRule');
const ledgerService = require('../../../services/ledgerService');
const {
  SERVICE_SETTING_KEYS,
  assertServiceEnabledOrRespond,
} = require('../../../services/serviceSettingsService');
const { normalizeRole } = require('../../../utils/permissions');
const sharedCcBillLimitService = require('../../../services/sharedCcBillLimitService');

// Debug logging helper for this controller
// Logs are written to the shared root /logs folder (same as auth.log etc.)
const bbpsLogFile = path.join(__dirname, '../../../logs/bbpsCCBill.log');
if (!fs.existsSync(path.dirname(bbpsLogFile))) {
  fs.mkdirSync(path.dirname(bbpsLogFile), { recursive: true });
}
function bbpsFileLog(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(bbpsLogFile, line, 'utf8');
  } catch (err) {
    console.error('[bbpsCC] log write failed', err);
  }
}

// Return a valid IPv4 string for InstantPay (they reject IPv6 formats like ::1).
function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '0.0.0.0';
  // If IPv6 loopback or contains IPv4-mapped IPv6, extract IPv4
  const ipv4Match = ip.match(/(\d+\.\d+\.\d+\.\d+)/);
  if (ipv4Match) return ipv4Match[1];
  // If IPv6 loopback
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return '127.0.0.1';
  // Fallback to 0.0.0.0
  return '0.0.0.0';
}

// Normalize geoCode to a valid "lat,long" string (InstantPay expects numeric values).
// If invalid, return null so it can be omitted from the payload.
function normalizeGeoCode(geoCode) {
  if (!geoCode || typeof geoCode !== 'string') return null;
  const parts = geoCode.split(',').map((p) => p.trim());
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  // InstantPay requires exactly 4 decimal places
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/**
 * Helper: resolve outlet ID from JWT user payload or header fallback.
 * PHP equivalent: intval(session('outlet'))
 * Returns an integer, as InstantPay requires a valid numeric outletId.
 */
const getOutletId = (req) => {
  const raw = req.user?.ipay_outlet_id
    || req.headers['x-outlet-id']
    || process.env.IPAY_OUTLET_ID;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? null : parsed;
};

function getInstantPayErrorMessage(error) {
  const payload = error?.response?.data;
  if (payload) {
    if (typeof payload === 'string') return payload;
    return payload.message
      || payload.msg
      || payload.statusMsg
      || payload.error
      || payload.responseMessage
      || payload.data
      || JSON.stringify(payload);
  }
  return error?.message || 'InstantPay API request failed. Please try again.';
}

function logInstantPayError(context, error) {
  const upstream = error?.response?.data || error?.message || error;
  console.error(`[bbpsCC] ${context} error:`, upstream);

  let details = '';
  if (error?.response?.data) {
    details = typeof error.response.data === 'string'
      ? error.response.data
      : JSON.stringify(error.response.data, null, 2);
  } else if (error instanceof Error) {
    details = `${error.message}\n${error.stack}`;
  } else {
    details = JSON.stringify(error, null, 2);
  }
  bbpsFileLog(`[${context}] ${details}`);
}

// Calculate the configured BBPS CC charge for a given transaction amount.
// Falls back to a default ₹20 charge when no rule is configured.
async function calculateBbpsCcCharge(txnAmount) {
  const chargeRule = await BbpsCcChargeRule.findOne({
    where: {
      is_active: true,
      from_amount: { [Op.lte]: txnAmount },
      to_amount: { [Op.gte]: txnAmount },
    },
    order: [['from_amount', 'DESC']],
  });

  let chargeAmount = 20;
  if (chargeRule) {
    if (chargeRule.rate_type === 'flat') {
      chargeAmount = parseFloat(chargeRule.rate);
    } else {
      chargeAmount = parseFloat((txnAmount * parseFloat(chargeRule.rate)) / 100.0);
    }
  }

  return chargeAmount;
}

// Validate that the user has sufficient active balance to cover the transaction,
// the configured BBPS CC charge, and a safety buffer of ₹30.
async function ensureSufficientBalance(userId, txnAmount) {
  const chargeAmount = await calculateBbpsCcCharge(txnAmount);
  const minimumRequired = txnAmount + chargeAmount + 30;
  const currentBalance = await ledgerService.getAvailableBalance(userId);

  return {
    currentBalance,
    chargeAmount,
    minimumRequired,
    isSufficient: currentBalance >= minimumRequired,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bbps-cc/categories
// Fetch all BBPS utility categories from InstantPay.
// PHP ref: getCategory()
// ─────────────────────────────────────────────────────────────────────────────
const getCategories = asyncHandler(async (req, res) => {
  const outletId = getOutletId(req);
  if (!outletId) {
    return res.status(400).json({
      success: false,
      message: 'InstantPay outlet ID is not configured for this user. Please complete KYC or contact support.',
    });
  }

  try {
    const data = await bbpsCCBillService.getCategories(outletId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logInstantPayError('getCategories', error);
    const message = getInstantPayErrorMessage(error);
    return res.status(error?.response ? 502 : 500).json({ success: false, message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bbps-cc/billers
// Fetch billers list for Credit Card (InstantPay category key C15).
// PHP ref: getBillersForCreditCards()
// ─────────────────────────────────────────────────────────────────────────────
const getCCBillers = asyncHandler(async (req, res) => {
  const outletId = getOutletId(req);
  bbpsFileLog(`[getCCBillers] request outletId=${outletId} userId=${req.user?.id || 'unknown'} ip=${req.ip}`);

  if (!outletId) {
    bbpsFileLog('[getCCBillers] missing outletId for request');
    return res.status(400).json({
      success: false,
      message: 'InstantPay outlet ID is not configured for this user. Please complete KYC or contact support.',
    });
  }

  try {
    const billers = await bbpsCCBillService.getCCBillers(outletId);
    return res.status(200).json({ success: true, count: billers.length, data: billers });
  } catch (error) {
    logInstantPayError('getCCBillers', error);
    bbpsFileLog(`[getCCBillers] failed outletId=${outletId} userId=${req.user?.id || 'unknown'} ip=${req.ip}`);
    const message = getInstantPayErrorMessage(error);
    return res.status(error?.response ? 502 : 500).json({ success: false, message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bbps-cc/biller-details
// Fetch parameter schema and details for a specific biller.
// PHP ref: getBillerDetails()
//
// Body: { billerId: string }
// ─────────────────────────────────────────────────────────────────────────────
const getBillerDetails = asyncHandler(async (req, res) => {
  try {
    const { billerId } = req.body;
    if (!billerId) {
      return res.status(400).json({ success: false, message: 'billerId is required' });
    }
    const data = await bbpsCCBillService.getBillerDetails(billerId, getOutletId(req));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[bbpsCC] getBillerDetails error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bbps-cc/pre-payment-enquiry
// Fetch/validate bill before payment (required when biller demands it).
// PHP ref: getAllData() → supportValidation/fetchRequirement MANDATORY branch
//
// Body:
//   billerId            – string (required)
//   initChannel         – string, e.g. 'Internet' (required)
//   param1              – card / account number (required)
//   param2              – secondary param if biller needs it
//   transactionAmount   – number (required)
//   customerMobile      – 10-digit mobile (optional, used in remarks)
// ─────────────────────────────────────────────────────────────────────────────
const prePaymentEnquiry = asyncHandler(async (req, res) => {
  try {
    const { billerId, param1, param2, transactionAmount, customerMobile } = req.body;

    if (!billerId || !param1 || !transactionAmount) {
      return res.status(400).json({
        success: false,
        message: 'Required: billerId, param1, transactionAmount',
      });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const txnAmount = parseFloat(transactionAmount);
    if (Number.isNaN(txnAmount) || txnAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid transactionAmount' });
    }

    if (!(await assertServiceEnabledOrRespond(res, SERVICE_SETTING_KEYS.CC_BILL_PAY, req.user))) {
      return;
    }

    const balanceCheck = await ensureSufficientBalance(userId, txnAmount);
    if (!balanceCheck.isSufficient) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Minimum required is ₹${balanceCheck.minimumRequired.toFixed(2)} (transaction + charge + buffer).`,
        currentBalance: balanceCheck.currentBalance,
        requiredBalance: balanceCheck.minimumRequired,
        requiredCharge: balanceCheck.chargeAmount,
      });
    }

// Fixed initChannel required by InstantPay for this integration.
    const initChannel = 'AGT';

    const result = await bbpsCCBillService.prePaymentEnquiry({
      billerId,
      initChannel,
      param1,
      param2,
      transactionAmount,
      customerMobile,
      geoCode: normalizeGeoCode(req.body.geoCode),
      ipAddress: normalizeIp(req.ip),
      outletId:  getOutletId(req),
    });

    // Log the raw response to help debug missing enquiryReferenceId cases.
    bbpsFileLog(`prePaymentEnquiry response for billerId=${billerId}: ${JSON.stringify(result)}`);

    const enquiryReferenceId = result.data?.data?.enquiryReferenceId ?? null;

    if (!enquiryReferenceId) {
      // Log full response for investigation (enquiryReferenceId missing)
      bbpsFileLog(`Missing enquiryReferenceId for billerId=${billerId} body=${JSON.stringify(req.body)} response=${JSON.stringify(result)}`);
    }

    return res.status(200).json({
      success:             true,
      message:             'Pre-payment enquiry successful',
      externalRef:         result.externalRef,
      enquiryReferenceId, // returned to the frontend for use in /pay
      data:                result.data,
    });
  } catch (error) {
    console.error('[bbpsCC] prePaymentEnquiry error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bbps-cc/pay
// Execute CC bill payment via InstantPay.
// PHP ref: paybill()
//
// Body:
//   billerId              – string (required)
//   initChannel           – string, e.g. 'Internet' (required)
//   param1                – card / account number (required)
//   param2                – secondary param if biller needs it
//   transactionAmount     – number in rupees (required)
//   customerMobile        – 10-digit mobile (required)
//   paymentMode           – 'Cash' | 'UPI' | etc. (default: 'Cash')
//   paymentInfo           – object: dynamic fields for the selected paymentMode
//                           (schema from /biller-details → paymentModes[n].paymentInfo)
//   enquiryReferenceId    – from prior prePaymentEnquiry (if applicable)
//   geoCode               – 'lat,long' string (optional)
//   customerPan           – PAN card number (optional, required by some billers)
//
// ⚠️  statuscode TXN / TUP = success on InstantPay.
//     Wallet debit and WalletTransaction logging happen here after a successful response.
// ─────────────────────────────────────────────────────────────────────────────
const getCcBillPayments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const offset = (page - 1) * limit;

  const { billerId, externalRef, statuscode, status, customerMobile } = req.query;

  const userRole = normalizeRole(req.user?.role);
  const isAdminOrEmployee = userRole === 'admin' || userRole === 'employee';

  const where = {};
  if (!isAdminOrEmployee) {
    where.user_id = req.user?.id;
  }
  if (billerId) {
    where.biller_id = billerId;
  }
  if (externalRef) {
    where.external_ref = { [Op.iLike]: `%${externalRef}%` };
  }
  if (statuscode) {
    where.statuscode = statuscode;
  }
  if (status) {
    where.status = status;
  }
  if (customerMobile) {
    where.customer_mobile = customerMobile;
  }

  const { count, rows } = await CcBillPayment.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });

  return res.status(200).json({ success: true, count, data: rows });
});

const getCcBillPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const record = await CcBillPayment.findByPk(id);
  if (!record) {
    return res.status(404).json({ success: false, message: 'Payment record not found' });
  }
  const userRole = normalizeRole(req.user?.role);
  const isAdminOrEmployee = userRole === 'admin' || userRole === 'employee';
  if (!isAdminOrEmployee && record.user_id !== req.user?.id) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  return res.status(200).json({ success: true, data: record });
});

const getBbpsCcChargeRules = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const rules = await BbpsCcChargeRule.findAll({ order: [['from_amount', 'ASC']] });
  return res.status(200).json({ success: true, data: rules });
});

const createBbpsCcChargeRule = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const { from_amount, to_amount, rate, rate_type, is_active, description } = req.body;
  if (!from_amount || !to_amount || !rate || !rate_type) {
    return res.status(400).json({ success: false, message: 'from_amount, to_amount, rate, and rate_type are required' });
  }
  if (!['percentage', 'flat'].includes(rate_type)) {
    return res.status(400).json({ success: false, message: 'rate_type must be percentage or flat' });
  }

  const rule = await BbpsCcChargeRule.create({
    from_amount,
    to_amount,
    rate,
    rate_type,
    is_active: is_active !== undefined ? is_active : true,
    description,
  });

  return res.status(201).json({ success: true, data: rule });
});

const updateBbpsCcChargeRule = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const rule = await BbpsCcChargeRule.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'Charge rule not found' });
  }

  const { from_amount, to_amount, rate, rate_type, is_active, description } = req.body;
  if (from_amount !== undefined) rule.from_amount = from_amount;
  if (to_amount !== undefined) rule.to_amount = to_amount;
  if (rate !== undefined) rule.rate = rate;
  if (rate_type !== undefined) {
    if (!['percentage', 'flat'].includes(rate_type)) {
      return res.status(400).json({ success: false, message: 'rate_type must be percentage or flat' });
    }
    rule.rate_type = rate_type;
  }
  if (is_active !== undefined) rule.is_active = is_active;
  if (description !== undefined) rule.description = description;

  await rule.save();
  return res.status(200).json({ success: true, data: rule });
});

const deleteBbpsCcChargeRule = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const rule = await BbpsCcChargeRule.findByPk(req.params.id);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'Charge rule not found' });
  }

  await rule.destroy();
  return res.status(200).json({ success: true, message: 'Charge rule deleted' });
});

const payCCBill = asyncHandler(async (req, res) => {
  try {
    const {
      billerId,
      param1,
      param2,
      transactionAmount,
      customerMobile,
      paymentMode,
      paymentInfo,
      enquiryReferenceId,
      geoCode,
      customerPan,
    } = req.body;

    if (!billerId || !param1 || !transactionAmount || !customerMobile) {
      return res.status(400).json({
        success: false,
        message: 'Required: billerId, param1, transactionAmount, customerMobile',
      });
    }

    const companyId = req.company;

    if(!companyId){
      console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
      return res.status(400).json({message : "No Domain Name is registered"});
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const txnAmount = parseFloat(transactionAmount);
    if (Number.isNaN(txnAmount) || txnAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid transactionAmount' });
    }

    if (!(await assertServiceEnabledOrRespond(res, SERVICE_SETTING_KEYS.CC_BILL_PAY, req.user))) {
      return;
    }

    const balanceCheck = await ensureSufficientBalance(userId, txnAmount);
    if (!balanceCheck.isSufficient) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Minimum required is ₹${balanceCheck.minimumRequired.toFixed(2)} (transaction + charge + buffer).`,
        currentBalance: balanceCheck.currentBalance,
        requiredBalance: balanceCheck.minimumRequired,
        requiredCharge: balanceCheck.chargeAmount,
      });
    }

// Fixed initChannel required by InstantPay for this integration.
    const initChannel = 'AGT';

    // Generate the external reference BEFORE creating the pending record so it is
    // always persisted (even if the InstantPay call later fails or times out).
    const externalRef = bbpsCCBillService.generateExternalRef();

    // ── Enforce Admin Shared Daily CC Bill Limit ──────────────────────────────
    try {
      await sharedCcBillLimitService.reserveLimit({
        userId,
        amount: txnAmount,
        flow: 'bbps_cc',
        referenceId: externalRef,
      });
    } catch (limitErr) {
      if (limitErr.code === 'CC_BILL_DAILY_LIMIT_EXCEEDED') {
        return res.status(400).json({
          success: false,
          message: limitErr.message,
          code: 'CC_BILL_DAILY_LIMIT_EXCEEDED',
          data: limitErr.data,
        });
      }
      return res.status(limitErr.statusCode || 400).json({
        success: false,
        message: limitErr.message || 'CC bill limit check failed',
        code: limitErr.code || 'LIMIT_ERROR',
      });
    }

    // Create a pending CC bill payment record early so ledger/wallet tx can reference it
    const ccPayment = await CcBillPayment.create({
      user_id:            userId,
      biller_id:          billerId,
      param1,
      param2,
      transaction_amount: txnAmount,
      customer_mobile:    customerMobile,
      payment_mode:       paymentMode || 'Cash',
      payment_info:       paymentInfo || { Remarks: 'CC Bill Payment' },
      enquiry_reference_id: enquiryReferenceId,
      external_ref:       externalRef,
      status:             'pending',
      geo_code:           normalizeGeoCode(geoCode),
      company_id : companyId,
    });

    // ── Step 1: Create ledger entry to debit the user balance (before calling InstantPay)
    let ledgerEntry = null;

    if (userId && txnAmount > 0) {
      ledgerEntry = await ledgerService.createLedgerEntry({
        userId,
        transactionType: 'bbps_payment',
        referenceId: ccPayment.id,
        referenceTable: 'CcBillPayments',
        description: `BBPS CC bill payment — biller: ${billerId}, mobile: ${customerMobile}`,
        debit: txnAmount,
        metadata: {
          biller_id: billerId,
          customer_mobile: customerMobile,
          payment_mode: paymentMode || 'Cash',
        }
      });
    }

// ── Step 2: Call InstantPay ──────────────────────────────────────────────
    const result = await bbpsCCBillService.payCCBill({
      billerId,
      initChannel,
      param1,
      param2,
      transactionAmount,
      customerMobile,
      paymentMode:        paymentMode || 'Cash',
      paymentInfo:        paymentInfo || { Remarks: 'CC Bill Payment' },
      enquiryReferenceId,
      geoCode: normalizeGeoCode(geoCode),
      customerPan,
      ipAddress: normalizeIp(req.ip),
      outletId:  getOutletId(req),
      externalRef, // reuse the reference already persisted on the pending record
    });

    const isSuccess = ['TXN', 'TUP'].includes(result.data?.statuscode);

    // Determine configured BBPS CC charge (percentage or flat) based on txn amount
    const chargeAmount = await calculateBbpsCcCharge(txnAmount);

    // Persist final payment attempt details (success or failure)
    await ccPayment.update({
      external_ref:       result.externalRef,
      statuscode:         result.data?.statuscode,
      status:             result.data?.status,
      response:           result.data,
      charge_amount:      chargeAmount,
      company_id : companyId,
    });

    // ── Step 3: Finalise or reverse based on result ─────────────────────────
    if (isSuccess) {
      if (ledgerEntry) {
        ledgerEntry.transaction_id = result.externalRef || null;
        ledgerEntry.metadata = JSON.stringify({
          biller_id: billerId,
          customer_mobile: customerMobile,
          payment_mode: paymentMode || 'Cash',
          statuscode: result.data?.statuscode,
          external_ref: result.externalRef,
        });
        await ledgerEntry.save();
      }

      // Deduct charge (if configured) after successful payment
      if (chargeAmount > 0 && userId) {
        await ledgerService.createLedgerEntry({
          userId,
          transactionType: 'bbps_charge',
          transactionId: result.externalRef || null,
          referenceId: ccPayment.id,
          referenceTable: 'CcBillPayments',
          description: `BBPS CC payment charge — ${chargeAmount}`,
          debit: chargeAmount,
          metadata: {
            biller_id: billerId,
            charge_amount: chargeAmount,
            external_ref: result.externalRef,
          },
        });
      }

      // Convert reservation to consumed usage only on definitive success; retain as RESERVED if pending (TUP)
      if (result.data?.statuscode === 'TXN' || (result.data?.status || '').toString().toUpperCase() === 'SUCCESS') {
        await sharedCcBillLimitService.commitReservation({
          flow: 'bbps_cc',
          referenceId: externalRef,
        });
      }
    } else {
      // Payment failed — reverse the ledger debit
      bbpsFileLog(`payCCBill failed for billerId=${billerId} body=${JSON.stringify(req.body)} response=${JSON.stringify(result)}`);

      await ledgerService.createLedgerEntry({
        userId,
        transactionType: 'bbps_payment_reversal',
        transactionId: result.externalRef || null,
        referenceId: ccPayment.id,
        referenceTable: 'CcBillPayments',
        description: `Reversed — BBPS CC payment failed (${result.data?.status || 'unknown'})`,
        credit: txnAmount,
        metadata: {
          biller_id: billerId,
          original_ledger_id: ledgerEntry?.id,
          statuscode: result.data?.statuscode,
          external_ref: result.externalRef,
        }
      });

      // Release reservation only if definitive failure; retain if pending/unknown
      const statuscodeUpper = (result.data?.statuscode || '').toString().toUpperCase();
      const statusUpper = (result.data?.status || '').toString().toUpperCase();
      const failedStatusCodes = ['TRP', 'FAILED', 'SPE', 'FAILURE', 'REJECTED', 'CANCELLED', 'REVERSED'];
      if (failedStatusCodes.includes(statuscodeUpper) || statusUpper === 'FAILED') {
        await sharedCcBillLimitService.releaseReservation({
          flow: 'bbps_cc',
          referenceId: externalRef,
        });
      }
    }

    return res.status(200).json({
      success:     isSuccess,
      message:     isSuccess ? 'CC bill payment successful' : (result.data?.status || 'Payment failed'),
      externalRef: result.externalRef,
      statuscode:  result.data?.statuscode,
      data:        result.data,
    });
  } catch (error) {
    console.error('[bbpsCC] payCCBill error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

/**
 * POST /api/bbps-cc/manual-refund
 * Admin / Employee manual refund for failed BBPS CC bill payments where balance was debited.
 */
const manualRefundBbpsCcBill = asyncHandler(async (req, res) => {
  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  const { reference_id, ledger_id, reason } = req.body;

  if (!reference_id && !ledger_id) {
    return res.status(400).json({
      success: false,
      message: 'reference_id or ledger_id is required to process manual refund',
    });
  }

  let ccPayment = null;
  let debitLedger = null;

  if (reference_id) {
    ccPayment = await CcBillPayment.findByPk(reference_id);
  }

  if (ledger_id) {
    debitLedger = await Ledger.findByPk(ledger_id);
    if (debitLedger && !ccPayment && debitLedger.reference_id) {
      ccPayment = await CcBillPayment.findByPk(debitLedger.reference_id);
    }
  }

  if (!debitLedger && ccPayment) {
    debitLedger = await Ledger.findOne({
      where: {
        transaction_type: 'bbps_payment',
        reference_id: ccPayment.id,
      },
    });
  }

  if (!ccPayment && !debitLedger) {
    return res.status(404).json({
      success: false,
      message: 'CC bill payment or ledger record not found',
    });
  }

  const paymentId = ccPayment?.id || debitLedger?.reference_id;
  const userId = ccPayment?.user_id || debitLedger?.user_id;

  // Query all debit entries for this CC bill payment (bbps_payment + bbps_charge if debited)
  const allDebits = await Ledger.findAll({
    where: {
      reference_id: paymentId,
      transaction_type: { [Op.in]: ['bbps_payment', 'bbps_charge'] }
    }
  });

  let paymentDebit = 0;
  let chargeDebit = 0;

  for (const entry of allDebits) {
    const d = parseFloat(entry.debit) || 0;
    if (entry.transaction_type === 'bbps_payment') {
      paymentDebit += d;
    } else if (entry.transaction_type === 'bbps_charge') {
      chargeDebit += d;
    }
  }

  if (paymentDebit === 0 && ccPayment?.transaction_amount) {
    paymentDebit = parseFloat(ccPayment.transaction_amount) || 0;
  }

  const totalRefundAmount = paymentDebit + chargeDebit;

  if (!totalRefundAmount || totalRefundAmount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'No balance was debited for this transaction; refund cannot be processed.',
    });
  }

  const existingReversal = await Ledger.findOne({
    where: {
      transaction_type: 'bbps_payment_reversal',
      reference_id: paymentId,
    },
  });

  if (existingReversal) {
    return res.status(400).json({
      success: false,
      message: `Refund has already been processed for this transaction (Reversal Ledger #${existingReversal.id}).`,
      existingReversalId: existingReversal.id,
    });
  }

  const performerName = req.user?.name || req.user?.abheepay_id || req.user?.email || `User #${req.user?.id || 'Admin'}`;
  const performerRole = req.user?.role || 'admin';

  const refundDesc = `Manual Refund for failed BBPS CC payment (${ccPayment?.external_ref || paymentId}) — Principal: ₹${paymentDebit.toFixed(2)}${chargeDebit > 0 ? `, Charge Refunded: ₹${chargeDebit.toFixed(2)}` : ''} by ${performerName}`;

  const refundEntry = await ledgerService.createLedgerEntry({
    userId,
    transactionType: 'bbps_payment_reversal',
    referenceId: paymentId,
    referenceTable: 'CcBillPayments',
    description: refundDesc,
    credit: totalRefundAmount,
    metadata: {
      biller_id: ccPayment?.biller_id || debitLedger?.metadata?.biller_id || null,
      original_ledger_id: debitLedger?.id || null,
      external_ref: ccPayment?.external_ref || null,
      principal_debit: paymentDebit,
      charge_debit: chargeDebit,
      total_refund_amount: totalRefundAmount,
      charge_refunded: chargeDebit > 0,
      refund_source: 'admin_manual_refund',
      performed_by_id: req.user?.id || null,
      performed_by_name: performerName,
      performed_by_role: performerRole,
      performed_at: new Date().toISOString(),
      reason: reason || 'Admin manual refund',
    },
  });

  if (ccPayment) {
    try {
      await ccPayment.update({
        status: 'FAILED (REFUNDED)',
        company_id : companyId,
      });
      if (ccPayment.external_ref) {
        await sharedCcBillLimitService.releaseReservation({
          flow: 'bbps_cc',
          referenceId: ccPayment.external_ref,
        });
      }
    } catch (_) {}
  }

  return res.status(200).json({
    success: true,
    message: `Manual refund of ₹${refundAmount.toFixed(2)} issued successfully!`,
    refundLedgerId: refundEntry.id,
    refundAmount,
    performedBy: {
      id: req.user?.id,
      name: performerName,
      role: performerRole,
    },
  });
});

module.exports = {
  getCategories,
  getCCBillers,
  getBillerDetails,
  prePaymentEnquiry,
  payCCBill,
  getCcBillPayments,
  getCcBillPayment,
  getBbpsCcChargeRules,
  createBbpsCcChargeRule,
  updateBbpsCcChargeRule,
  deleteBbpsCcChargeRule,
  manualRefundBbpsCcBill,
};

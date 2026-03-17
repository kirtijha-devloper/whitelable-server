const asyncHandler = require('express-async-handler');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const bbpsCCBillService = require('../../../services/cc/bbps/bbpsCCBillService');
const User = require('../../../models/User');
const WalletTransaction = require('../../../models/WalletTransaction');
const CcBillPayment = require('../../../models/CcBillPayment');
const BbpsCcChargeRule = require('../../../models/BbpsCcChargeRule');
const ledgerService = require('../../../services/ledgerService');

// Debug logging helper for this controller
// Logs are written to the shared root /logs folder (same as auth.log etc.)
const bbpsLogFile = path.join(__dirname, '../../../logs/bbpsCCBill.log');
function bbpsFileLog(message) {
  const timestamp = new Date().toISOString();
  fs.appendFile(bbpsLogFile, `[${timestamp}] ${message}\n`, (err) => {
    if (err) console.error('[bbpsCC] log write failed', err);
  });
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bbps-cc/categories
// Fetch all BBPS utility categories from InstantPay.
// PHP ref: getCategory()
// ─────────────────────────────────────────────────────────────────────────────
const getCategories = asyncHandler(async (req, res) => {
  try {
    const data = await bbpsCCBillService.getCategories(getOutletId(req));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[bbpsCC] getCategories error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bbps-cc/billers
// Fetch billers list for Credit Card (InstantPay category key C15).
// PHP ref: getBillersForCreditCards()
// ─────────────────────────────────────────────────────────────────────────────
const getCCBillers = asyncHandler(async (req, res) => {
  try {
    const billers = await bbpsCCBillService.getCCBillers(getOutletId(req));
    return res.status(200).json({ success: true, count: billers.length, data: billers });
  } catch (error) {
    console.error('[bbpsCC] getCCBillers error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
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

  const where = {};
  if (req.user?.role !== 'admin') {
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
  if (req.user?.role !== 'admin' && record.user_id !== req.user?.id) {
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

    // Fixed initChannel required by InstantPay for this integration.
    const initChannel = 'AGT';

    const userId = req.user?.id;
    const txnAmount = parseFloat(transactionAmount);

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
      status:             'pending',
      geo_code:           normalizeGeoCode(geoCode),
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
        status: 'pending',
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
    });

    const isSuccess = ['TXN', 'TUP'].includes(result.data?.statuscode);

    // Calculate any configured BBPS CC charge (percentage or flat) based on txn amount
    const chargeRule = await BbpsCcChargeRule.findOne({
      where: {
        is_active: true,
        from_amount: { [Op.lte]: txnAmount },
        to_amount:   { [Op.gte]: txnAmount },
      },
      order: [['from_amount', 'DESC']],
    });

    // Default charge when no rule is configured
    let chargeAmount = 20;
    if (chargeRule) {
      if (chargeRule.rate_type === 'flat') {
        chargeAmount = parseFloat(chargeRule.rate);
      } else {
        chargeAmount = parseFloat((txnAmount * parseFloat(chargeRule.rate)) / 100.0);
      }
    }

    // Persist final payment attempt details (success or failure)
    await ccPayment.update({
      external_ref:       result.externalRef,
      statuscode:         result.data?.statuscode,
      status:             result.data?.status,
      response:           result.data,
      charge_amount:      chargeAmount,
    });

    // ── Step 3: Finalise or reverse based on result ─────────────────────────
    if (isSuccess) {
      if (ledgerEntry) {
        ledgerEntry.status = 'completed';
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
          status: 'completed',
          metadata: {
            biller_id: billerId,
            charge_amount: chargeAmount,
            external_ref: result.externalRef,
          },
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
        status: 'completed',
        metadata: {
          biller_id: billerId,
          original_ledger_id: ledgerEntry?.id,
          statuscode: result.data?.statuscode,
          external_ref: result.externalRef,
        }
      });

      if (ledgerEntry) {
        ledgerEntry.status = 'reversed';
        await ledgerEntry.save();
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

module.exports = {
  getCategories,
  getCCBillers,
  getBillerDetails,
  prePaymentEnquiry,
  payCCBill,
  getCcBillPayments,
  getCcBillPayment,
};

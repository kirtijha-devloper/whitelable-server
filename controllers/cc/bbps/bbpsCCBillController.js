const asyncHandler = require('express-async-handler');
const fs = require('fs');
const path = require('path');
const bbpsCCBillService = require('../../../services/cc/bbps/bbpsCCBillService');
const User = require('../../../models/User');
const WalletTransaction = require('../../../models/WalletTransaction');
const ledgerService = require('../../../services/ledgerService');

// Debug logging helper for this controller
const bbpsLogFile = path.join(__dirname, '../../logs/bbpsCCBill.log');
function bbpsFileLog(message) {
  const timestamp = new Date().toISOString();
  fs.appendFile(bbpsLogFile, `[${timestamp}] ${message}\n`, (err) => {
    if (err) console.error('[bbpsCC] log write failed', err);
  });
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
      ipAddress: req.ip,
      outletId:  getOutletId(req),
    });

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
      geoCode,
      customerPan,
      ipAddress: req.ip,
      outletId:  getOutletId(req),
    });

    const isSuccess = ['TXN', 'TUP'].includes(result.data?.statuscode);

    // ── Wallet debit + ledger entry on successful payment ────────────────────
    if (isSuccess) {
      const userId = req.user?.id;
      const txnAmount = parseFloat(transactionAmount);

      if (userId && txnAmount > 0) {
        // NOTE: createLedgerEntry() below syncs user.wallet as its last step — no manual update needed here.
        const walletTx = await WalletTransaction.create({
          type: 'bbps',
          amount: txnAmount,
          status: 'completed',
          reason: `BBPS CC bill payment — biller: ${billerId}, mobile: ${customerMobile}`,
          source: 'bbps_cc',
          reference_id: result.externalRef || null
        });

        await ledgerService.createLedgerEntry({
          userId,
          transactionType: 'bbps_payment',
          transactionId: result.externalRef || null,
          referenceId: walletTx.id,
          referenceTable: 'WalletTransactions',
          description: `BBPS CC bill payment — biller: ${billerId}, mobile: ${customerMobile}`,
          debit: txnAmount,
          status: 'completed',
          metadata: {
            biller_id: billerId,
            customer_mobile: customerMobile,
            payment_mode: paymentMode || 'Cash',
            statuscode: result.data?.statuscode,
            external_ref: result.externalRef
          }
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

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
};

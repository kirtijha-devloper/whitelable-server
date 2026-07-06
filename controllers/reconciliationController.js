const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');

const PayoutTransaction = require('../models/PayoutTransaction');
const CcBillPayment = require('../models/CcBillPayment');
const BillAvenuePayment = require('../models/BillAvenuePayment');



// GET /api/reconciliation
// Simple endpoint to confirm the reconciliation API is reachable.
const reconcileEndpointWorking = asyncHandler(async (req, res) => {
  return res.status(200).json({ success: true, message: 'end point working' });
});

const reconcile = asyncHandler(async (req, res) => {
  // Return all payout-related transactions created today (server local timezone)
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const payoutTransactions = await PayoutTransaction.findAll({
    where: {
      createdAt: {
        [Op.between]: [start, end],
      },
    },
    attributes: ['id', 'reference_id', 'amount', 'payout_provider', 'status'],
    order: [['createdAt', 'DESC']],
  });

  const ccBillPayments = await CcBillPayment.findAll({
    where: {
      createdAt: {
        [Op.between]: [start, end],
      },
    },
    attributes: ['id', 'transaction_amount', 'external_ref', 'statuscode', 'status'],
    order: [['createdAt', 'DESC']],
  });

  const billAvenuePayments = await BillAvenuePayment.findAll({
    where: {
      createdAt: {
        [Op.between]: [start, end],
      },
    },
    attributes: ['id', 'transaction_amount', 'transaction_ref_id', 'status', 'response_code'],
    order: [['createdAt', 'DESC']],
  });

  return res.status(200).json({
    success: true,
    payoutTransactions,
    ccBillPayments,
    billAvenuePayments,
    payoutCount: payoutTransactions.length,
    ccBillPaymentCount: ccBillPayments.length,
    billAvenuePaymentCount: billAvenuePayments.length,
    count: payoutTransactions.length + ccBillPayments.length + billAvenuePayments.length,
  });
});



module.exports = {
  reconcileEndpointWorking,
  reconcile,
};



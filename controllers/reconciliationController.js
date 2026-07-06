const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');

const PayoutTransaction = require('../models/PayoutTransaction');

// GET /api/reconciliation
// Simple endpoint to confirm the reconciliation API is reachable.
const reconcileEndpointWorking = asyncHandler(async (req, res) => {
  return res.status(200).json({ success: true, message: 'end point working' });
});

const reconcile = asyncHandler(async (req, res) => {
  // Return all PayoutTransaction rows created today (server local timezone)
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const transactions = await PayoutTransaction.findAll({
    where: {
      createdAt: {
        [Op.between]: [start, end],
      },
    },
    attributes: ['id', 'reference_id', 'amount', 'payout_provider', 'status'],
    order: [['createdAt', 'DESC']],
  });

  return res.status(200).json({
    success: true,
    count: transactions.length,
    transactions,
  });
});


module.exports = {
  reconcileEndpointWorking,
  reconcile,
};



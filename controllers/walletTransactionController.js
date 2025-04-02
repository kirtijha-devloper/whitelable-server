const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const PosMachine = require('../models/posMachine');
const { Op } = require('sequelize');


const requestFund = asyncHandler(async (req, res) =>{
  const role = req.user.role
  const { user_id, amount, reason } = req.body;
  const user = await User.findByPk(user_id);
  if (!user) throw new Error("User not found");

  let source  = ''
  if (role === "merchant") {
    source = "merchant"
  }
  if (role == "franchaise") {
    source = "franchaise"
  }
  if (role == "admin") {
    source = "admin"
  } 

  const wallet = await WalletTransaction.create({
    type: "request",
    amount,
    status: "pending",
    reason,
    requested_by: user_id,
    source: source
  });

  res.status(200).json({ message: "Fund Requested", balance: user.wallet, id: wallet.id });
});

const transferFund = asyncHandler(async (req, res) =>{
    const id = req.params;
    const wallet_transaction = await WalletTransaction.findByPk(id);
    if (!wallet_transaction) throw new Error("Request not found");

    const user = await User.findByPk(wallet_transaction.requested_by)
     if (!user) throw new Error("User not found");

    user.wallet = parseFloat(user.wallet) + parseFloat(amount);
    await user.save();

    wallet_transaction.status = "completed"
    wallet_transaction.approved_by= req.user.id
    await wallet_transaction.save()
  
    res.status(200).json({ message: "Amount Transfered", balance: user.wallet, hold: user.wallet_hold });
})

const holdFund = asyncHandler(async (req, res) => {
  const { user_id, amount, reason } = req.body;
  const user = await User.findByPk(user_id);

  if (!user) throw new Error("User not found");
  if (parseFloat(user.wallet) < parseFloat(amount)) {
    throw new Error("Insufficient balance");
  }

  user.wallet -= parseFloat(amount);
  user.wallet_hold += parseFloat(amount);
  await user.save();

  await WalletTransaction.create({
    user_id,
    type: "hold",
    amount,
    status: "completed",
    reason,
    requested_by: req.user.id
  });

  res.status(200).json({ message: "Amount held", balance: user.wallet, hold: user.wallet_hold });
});

const unholdFund = asyncHandler(async (req, res) => {
  const { user_id, amount, reason } = req.body;
  const user = await User.findByPk(user_id);

  if (!user) throw new Error("User not found");
  if (parseFloat(user.wallet_hold) < parseFloat(amount)) {
    throw new Error("Insufficient held funds");
  }

  user.wallet_hold -= parseFloat(amount);
  user.wallet += parseFloat(amount);
  await user.save();

  await WalletTransaction.create({
    user_id,
    type: "unhold",
    amount,
    status: "completed",
    reason,
    requested_by: req.user.id
  });

  res.status(200).json({ message: "Amount unheld", balance: user.wallet, hold: user.wallet_hold });
});

const getWalletRequests = asyncHandler(async (req, res) => {
    
    const transactions = await WalletTransaction.findAll({
        order: [["createdAt", "DESC"]]
    });

    res.status(200).json(transactions);
    });

const getTransactionsByRole = asyncHandler(async (req, res) => {
  const { role, id } = req.user;

  let whereClause = {};

  if (role === 'franchaise') {
    // Get all POS machines for this franchise
    const machines = await PosMachine.findAll({
      where: { franchaise_id: id },
      attributes: ['assigned_user_id']
    });

    const assignedUserIds = machines.map(m => m.assigned_user_id);

    whereClause = {
      [Op.or]: [
        { requested_by: { [Op.in]: assignedUserIds } }
      ]
    };

  } else if (role === 'merchant') {

    whereClause = {
      [Op.or]: [
        { requested_by: { [Op.in]: id } }
      ]
    };

  } // admin gets all — leave whereClause empty

  const walletTransactions = await WalletTransaction.findAll({ where: whereClause });

  res.status(200).json({
    count: walletTransactions.length,
    data: walletTransactions
  });
});

const getWalletRequestById = asyncHandler(async (req, res) => {
    const id = req.params.id;
    const walletTransaction = await WalletTransaction.findByPk(id);
    if (!walletTransaction) {
      res.status(404);
      throw new Error('Transaction not found');
    };
    res.status(200).json(walletTransaction);
  });




module.exports = {
  requestFund,
  transferFund,
  holdFund,
  unholdFund,
  getWalletRequests,
  getTransactionsByRole,
  getWalletRequestById
} 
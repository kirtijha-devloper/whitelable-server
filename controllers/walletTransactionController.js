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
    amount: parseFloat(amount),
    status: "pending",
    reason,
    requested_by: user_id,
    source: source
  });

  res.status(200).json({ message: "Fund Requested", balance: user.wallet,hold: user.wallet_hold, id: wallet.id });
});

const transferFund = asyncHandler(async (req, res) =>{
  try{
    if (req.user.role !== "admin") {
      res.status(401);
      throw new Error("you are not allowed to transfer amount")
    }
    
  const {id} = req.params;
  const transactionId = parseInt(id, 10);

  if (isNaN(transactionId)) {
    res.status(400);
    throw new Error("Invalid transaction ID");
  }
    const walletTransaction = await WalletTransaction.findByPk(transactionId);
    if (walletTransaction.status !== "pending" && walletTransaction.type !== "request") {
      res.status(400);
      throw new Error("Wallet Transaction is not valid for transfer ")
    }
      

    if (!walletTransaction) throw new Error("Request not found");

    const user = await User.findByPk(walletTransaction.requested_by)

    if (!user) throw new Error("User not found");
    user.wallet = parseFloat(user.wallet) + parseFloat(walletTransaction.amount);
    await user.save();

    walletTransaction.status = "completed"
    walletTransaction.approved_by= req.user.id
    await walletTransaction.save()

    await WalletTransaction.create({
        type: "transfer",
        amount: parseFloat(walletTransaction.amount),
        status: "completed",
        reason: "Fund Tranfer",
        approved_by: req.user.id,
        requested_by: walletTransaction.requested_by,
        reference_id: walletTransaction.id
      });
  
    res.status(200).json({ message: "Amount Transfered", balance: user.wallet, hold: user.wallet_hold });
    } catch (err) {
        req.status(500);
        throw new Error("INter servererror")
    }
});

const holdFund = asyncHandler(async (req, res) => {
  const {id} = req.params;
  const transactionId = parseInt(id, 10);

  if (isNaN(transactionId)) {
    res.status(400);
    throw new Error("Invalid transaction ID");
  }
  const walletTransaction = await WalletTransaction.findByPk(transactionId);
  if (walletTransaction.status !== "pending" && walletTransaction.type !== "request") {
    res.status(400);
    throw new Error("WallentTransaction should be in pending status for hold")
  }

  const user = await User.findByPk(walletTransaction.requested_by);

  if (!user) throw new Error("Requested User not found");
  user.wallet_hold = parseFloat(user.wallet_hold) +  parseFloat(walletTransaction.amount);
  await user.save();

  walletTransaction.approved_by = req.user.id
  walletTransaction.status = "completed"
  await walletTransaction.save()

  await WalletTransaction.create({
          type: "hold",
          amount: parseFloat(walletTransaction.amount),
          status: "pending",
          reason: "HOLD AMOUNT",
          approved_by: req.user.id,
          requested_by: walletTransaction.requested_by,
          reference_id: walletTransaction.id
        });
  
  res.status(200).json({ message: "Amount held", balance: user.wallet, hold: user.wallet_hold });
});

const unholdFund = asyncHandler(async (req, res) => {
  const {id} = req.params;
  const transactionId = parseInt(id, 10);

  if (isNaN(transactionId)) {
    res.status(400);
    throw new Error("Invalid transaction ID");
  }
  const walletTransaction = await WalletTransaction.findByPk(transactionId);
  if (walletTransaction.status !== "pending" && walletTransaction.type !== "hold") {
    res.status(400);
    throw new Error("WallentTransaction should be in hold status for unhold")
  }

  const user = await User.findByPk(walletTransaction.requested_by);
  if (!user) throw new Error("Requested User not found");

  // if parseFloat(user.wallet_hold) < parseFloat(walletTransaction.amount)){
  // }
  user.wallet_hold = parseFloat(user.wallet_hold) -  parseFloat(walletTransaction.amount);
  user.wallet = parseFloat(user.wallet) +  parseFloat(walletTransaction.amount);
  await user.save();

  walletTransaction.approved_by = req.user.id
  walletTransaction.status = "completed"
  await walletTransaction.save()

  await WalletTransaction.create({
          type: "unhold",
          amount: parseFloat(walletTransaction.amount),
          status: "completed",
          reason: "UNHOLD AMOUNT",
          approved_by: req.user.id,
          requested_by: walletTransaction.requested_by,
          reference_id: walletTransaction.id
        });
  
  res.status(200).json({ message: "Amount held", balance: user.wallet, hold: user.wallet_hold });
});

const getUserWalletTransactions = asyncHandler(async (req, res) => {
    const { type, id: transactionId, status, user_id } = req.body;

     const where = {};
    if (transactionId) {
      where.id = transactionId;
    }

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (user_id) {
       where.requested_by = user_id;
    }

    const transactions = await WalletTransaction.findAll({
        where,
        order: [['createdAt', 'DESC']]
      });

    res.status(200).json({
      count: transactions.length,
      transactions,
  });
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
  getWalletRequestById,
  getUserWalletTransactions
} 
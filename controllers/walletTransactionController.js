const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const PosMachine = require('../models/posMachine');
const { Op } = require('sequelize');
const ledgerService = require('../services/ledgerService');

const requestFund = asyncHandler(async (req, res) =>{
  const role = req.user.role


  const { user_id, amount, reason } = req.body;

  if (!amount || parseFloat(amount) <= 0) {
    res.status(400);
    throw new Error("Amount must be greater than zero");
  }

  const user = await User.findByPk(user_id);
  if (!user) throw new Error("User not found");


  const wallet = await WalletTransaction.create({
    type: "request",
    amount: parseFloat(amount),
    status: "pending",
    reason,
    requested_by: user_id,
  });

  res.status(200).json({ message: "Fund Requested", balance: user.wallet, id: wallet.id });
});

const transferFund = asyncHandler(async (req, res) =>{
  try {
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
      if (!walletTransaction) {
        res.status(404);
        throw new Error("Request not found");
      }
      if (walletTransaction.status !== "pending" || walletTransaction.type !== "request") {
        res.status(400);
        throw new Error("Wallet Transaction is not valid for transfer ")
      }

      const sender = await User.findByPk(req.user.id); // the one approving
    console.log("sender balanece", sender)
        if (!sender) {
          res.status(404);
          throw new Error("Sender/approver not found");
        }
          console.log("sender waller", sender.wallet)

          if (parseFloat(sender.wallet) < parseFloat(walletTransaction.amount)) {
            res.status(400);
            throw new Error("Insufficient balance to transfer funds");
          }
      const receiver = await User.findByPk(walletTransaction.requested_by)

      if (!receiver) throw new Error("User not found");

      walletTransaction.status = "completed"
      walletTransaction.approved_by= req.user.id
      await walletTransaction.save()

      const transferTransaction = await WalletTransaction.create({
          type: "transfer",
          amount: parseFloat(walletTransaction.amount),
          status: "completed",
          reason: "Fund Tranfer",
          approved_by: req.user.id,
          requested_by: walletTransaction.requested_by,
          reference_id: walletTransaction.id
        });

      // Create ledger entries — these also update user.wallet via createLedgerEntry
      // Debit from sender
      await ledgerService.createLedgerEntry({
        userId: sender.id,
        transactionType: 'wallet_transfer_debit',
        transactionId: `transfer_${transferTransaction.id}`,
        referenceId: transferTransaction.id,
        description: `Fund transfer to user ${walletTransaction.requested_by}`,
        debit: parseFloat(walletTransaction.amount),
        metadata: { receiver_id: walletTransaction.requested_by, original_request_id: walletTransaction.id }
      });
 
      // Credit to receiver
      const receiverLedger = await ledgerService.createLedgerEntry({
        userId: walletTransaction.requested_by,
        transactionType: 'wallet_transfer_credit',
        transactionId: `transfer_${transferTransaction.id}`,
        referenceId: transferTransaction.id,
        description: `Fund transfer from user ${sender.id}`,
        credit: parseFloat(walletTransaction.amount),
        metadata: { sender_id: sender.id, original_request_id: walletTransaction.id }
      });
 
      res.status(200).json({ message: "Amount Transfered", balance: receiverLedger.balance });
  }
    catch (err) { console.error(err); 
      res.status(500).json({
      success: false,
      message: err.message || "Something went wrong",
    }); 
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
  if (!walletTransaction) {
    res.status(404);
    throw new Error("Request not found");
  }
  if (walletTransaction.status !== "pending" || walletTransaction.type !== "request") {
    res.status(400);
    throw new Error("WallentTransaction should be in pending status for hold")
  }

  const user = await User.findByPk(walletTransaction.requested_by);

  if (!user) throw new Error("Requested User not found");

  walletTransaction.approved_by = req.user.id
  walletTransaction.status = "completed"
  await walletTransaction.save()

  const holdTransaction = await WalletTransaction.create({
          type: "hold",
          amount: parseFloat(walletTransaction.amount),
          status: "pending",
          reason: "HOLD AMOUNT",
          approved_by: req.user.id,
          requested_by: walletTransaction.requested_by,
          reference_id: walletTransaction.id
        });

  res.status(200).json({
    message: "Request moved to hold",
    balance: user.wallet,
    hold_transaction_id: holdTransaction.id
  });
});

const unholdFund = asyncHandler(async (req, res) => {
  const {id} = req.params;
  const transactionId = parseInt(id, 10);

  if (isNaN(transactionId)) {
    res.status(400);
    throw new Error("Invalid transaction ID");
  }
  const walletTransaction = await WalletTransaction.findByPk(transactionId);
  if (!walletTransaction) {
    res.status(404);
    throw new Error("Hold request not found");
  }
  if (walletTransaction.status !== "pending" || walletTransaction.type !== "hold") {
    res.status(400);
    throw new Error("WallentTransaction should be in hold status for unhold")
  }

  const receiver = await User.findByPk(walletTransaction.requested_by);
  if (!receiver) throw new Error("Requested User not found");

   const sender = await User.findByPk(req.user.id); // the one approving
  if (!sender) {
    res.status(404);
    throw new Error("Sender/approver not found");
  }

  if (parseFloat(sender.wallet) < parseFloat(walletTransaction.amount)) {
    res.status(400);
    throw new Error("Insufficient balance to transfer funds");
  }

  walletTransaction.approved_by = req.user.id
  walletTransaction.status = "completed"
  await walletTransaction.save()

  const unholdTransaction = await WalletTransaction.create({
          type: "unhold",
          amount: parseFloat(walletTransaction.amount),
          status: "completed",
          reason: "UNHOLD AMOUNT",
          approved_by: req.user.id,
          requested_by: walletTransaction.requested_by,
          reference_id: walletTransaction.id
        });

  // Create ledger entries for unhold — these also update user.wallet via createLedgerEntry
  // Debit from sender (admin)
  await ledgerService.createLedgerEntry({
    userId: sender.id,
    transactionType: 'wallet_unhold_debit',
    transactionId: `unhold_${unholdTransaction.id}`,
    referenceId: unholdTransaction.id,
    description: `Unhold amount for user ${receiver.id}`,
    debit: parseFloat(walletTransaction.amount),
    metadata: { receiver_id: receiver.id, original_hold_id: walletTransaction.id }
  });

  // Credit to receiver
  const receiverLedger = await ledgerService.createLedgerEntry({
    userId: receiver.id,
    transactionType: 'wallet_unhold_credit',
    transactionId: `unhold_${unholdTransaction.id}`,
    referenceId: unholdTransaction.id,
    description: 'Amount unheld',
    credit: parseFloat(walletTransaction.amount),
    metadata: { sender_id: sender.id, original_hold_id: walletTransaction.id }
  });

  res.status(200).json({ message: "Amount unheld", balance: receiverLedger.balance });
});

const getUserWalletTransactions = asyncHandler(async (req, res) => {
  try {
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

     const formattedTransactions = await Promise.all(transactions.map(async (txn) => {
      let requestUserDetails = null;
      let approveUserDetails = null;

      if (txn.requested_by) {
        requestUserDetails = await User.findByPk(txn.requested_by, {
          attributes: ['id', 'name', 'email', 'abheepay_id'], // Select the required attributes
        });
      }
        if (txn.approved_by) {
        approveUserDetails = await User.findByPk(txn.approved_by, {
          attributes: ['id', 'name', 'email', 'abheepay_id'], // Select the required attributes
        });
      }


      return {
        id: txn.id,
        type: txn.type,
        status: txn.status,
        requested_by: txn.requested_by,
        approved_by: txn.approved_by,
        amount: txn.amount,
        reason: txn.reason,
        reference_id: txn.reference_id,
        createdAt: txn.createdAt,
        updatedAt: txn.updatedAt,
        request_details: requestUserDetails ? {
          id: requestUserDetails.id,
          name: requestUserDetails.name,
          email: requestUserDetails.email,
        } : null, // Include user details if available
        approve_details: approveUserDetails ? {
          id: approveUserDetails.id,
          name: approveUserDetails.name,
          email: approveUserDetails.email,
        } : null, // Include user details if available
      };
    }));

    res.status(200).json({
      count: formattedTransactions.length,
      transactions: formattedTransactions, // return the formatted transactions
    });
  } catch (err) { console.error(err); 
      res.status(500).json({
      success: false,
      message: err.message || "Something went wrong",
    }); }
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
      where: { assigned_to: id },
      attributes: ['assigned_to']
    });

    const assignedUserIds = machines.map(m => m.assigned_to);

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


const getSingleTransactionHistory = asyncHandler(async (req, res) => {
    const {id} = req.params
     const walletTransaction = await WalletTransaction.findByPk(id);
    if (!walletTransaction) {
      res.status(404);
      throw new Error("Wallet Transaction NOT FOUND")
    }
    const transactions = await WalletTransaction.findAll({
      where: { reference_id: walletTransaction.id },
      order: [["createdAt", "DESC"]],
    });

    const allTransactions = [walletTransaction.toJSON(), ...transactions];
    res.status(200).json({
      count: allTransactions.length,
      allTransactions,
    });
});

module.exports = {
  requestFund,
  transferFund,
  holdFund,
  unholdFund,
  getWalletRequests,
  getTransactionsByRole,
  getWalletRequestById,
  getUserWalletTransactions,
  getSingleTransactionHistory
} 

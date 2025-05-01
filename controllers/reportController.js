const asyncHandler = require("express-async-handler");
const { Op } = require('sequelize');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const Transaction = require("../models/Transaction");
const WalletTransaction = require("../models/WalletTransaction");

const getDateRange = (startDate, endDate) => {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const getPosTransactionReport = asyncHandler(async (req, res) => {
     try {
    const {
      startDate,
      endDate,
      status,
      cardHolderName,
      posTxnNo,
      deviceNo,
    } = req.query;

    const whereClause = {};

    if (startDate && endDate) {
      const { start, end } = getDateRange(startDate, endDate);
      whereClause.Date = {
        [Op.between]: [start, end],
      };
    }

    if (status) {
      whereClause.Status = status;
    }

    if (cardHolderName) {
      whereClause.Consumer = {
        [Op.like]: `%${cardHolderName}%`,
      };
    }

    if (posTxnNo) {
      whereClause.Invoice = posTxnNo;
    }

    if (deviceNo) {
      whereClause.DeviceSerial = deviceNo;
    }

    const transactions = await Transaction.findAll({
      where: whereClause,
      order: [["Date", "DESC"]],
    });

    res.status(200).json({
      message: "Transaction Report Fetched Successfully",
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    console.error("Error fetching transaction report:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  }
});

const getWalletReport = asyncHandler(async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.query;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // Fetch the user and current wallet balance
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const whereClause = {
      requested_by: userId,
      // status: "completed",
    };

    if (startDate && endDate) {
      whereClause.createdAt = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    const transactions = await WalletTransaction.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
    });

    // Start balance from user's current balance
    let balance = parseFloat(user.wallet);

    // Iterate in reverse to simulate running balance from current
    const report = transactions.reverse().map((txn, index) => {
      const amount = parseFloat(txn.amount);
      let debit = null;
      let credit = null;

      if (txn.type === "request" || txn.type === "transfer") {
        credit = amount;
        balance += amount;
      } else {
        debit = amount;
        balance -= amount;
      }

      return {
        id: txn.id,
        date_and_time: txn.createdAt,
        utr_no: txn.reference_id || "-",
        description: txn.reason || txn.type,
        debit: debit ? debit.toFixed(2) : "-",
        credit: credit ? credit.toFixed(2) : "-",
        balance: balance.toFixed(2),
        status: txn.status,
      };
    }).reverse(); // Reverse again to restore original order

    res.status(200).json({
      message: "Wallet transaction report fetched successfully",
      wallet_balance: user.wallet,
      count: report.length,
      data: report,
    });
  } catch (error) {
    console.error("Error generating wallet report:", error);
    res.status(500).json({ message: "Something went wrong" });
  }
});

module.exports = { getPosTransactionReport, getWalletReport };
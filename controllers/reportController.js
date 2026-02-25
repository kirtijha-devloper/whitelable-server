const asyncHandler = require("express-async-handler");
const { Op } = require('sequelize');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const Transaction = require("../models/Transaction");
const WalletTransaction = require("../models/WalletTransaction");
const RazorpayNotification = require("../models/RazorpayNotification");

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

    
    let whereClause = {}
      if (user.role !== "admin") {
        whereClause = {
          requested_by: userId,
          // status: "completed",
        };
      }

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

/**
 * GET /report/razorpay
 * User-wise RazorpayNotification report.
 *
 * Access rules:
 *  - admin     : must supply user_id to see a specific user; omit for all records.
 *  - franchaise: own records OR any merchant under them.
 *  - merchant  : only their own records.
 *
 * Query params:
 *  user_id        – target user (required for admin, ignored for merchant)
 *  start_date     – ISO date string (inclusive)
 *  end_date       – ISO date string (inclusive, extended to 23:59:59)
 *  status         – e.g. AUTHORIZED, FAILED, VOIDED, CAPTURED
 *  payment_mode   – e.g. CARD, UPI
 *  include_unlinked – 'true' (admin only) to also include rows where user_id IS NULL
 *  page           – default 1
 *  limit          – default 50
 */
const getRazorpayNotificationReport = asyncHandler(async (req, res) => {
  try {
    const userRole = req.user?.role;
    const currentUserId = req.user?.id;
    const {
      user_id,
      start_date,
      end_date,
      status,
      payment_mode,
      include_unlinked = 'false',
      page = 1,
      limit = 50
    } = req.query;

    // ── Date range — defaults to today when not supplied ─────────────────────
    const today = new Date();

    const fromDate = start_date ? new Date(start_date) : new Date(today);
    fromDate.setHours(0, 0, 0, 0);

    const toDate = end_date ? new Date(end_date) : new Date(today);
    toDate.setHours(23, 59, 59, 999);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Use YYYY-MM-DD.'
      });
    }

    if (fromDate > toDate) {
      return res.status(400).json({
        success: false,
        message: 'start_date must not be after end_date'
      });
    }

    // Filter on posting_date (indexed composite key: user_id + posting_date).
    // posting_date is the actual transaction date from the Razorpay payload — far
    // more meaningful for financial reports than createdAt (webhook receipt time).
    // Rows where posting_date IS NULL (rare backfill gaps) fall back to createdAt.
    const where = {
      [Op.or]: [
        { posting_date: { [Op.between]: [fromDate, toDate] } },
        {
          posting_date: null,
          createdAt: { [Op.between]: [fromDate, toDate] }
        }
      ]
    };

    // ── Role-based scoping ───────────────────────────────────────────────────
    if (userRole === 'merchant') {
      where.user_id = currentUserId;

    } else if (userRole === 'franchaise') {
      if (user_id) {
        const targetUser = await User.findOne({
          where: { id: user_id, franchaise_id: currentUserId, status: 'active' }
        });
        if (!targetUser) {
          return res.status(403).json({
            success: false,
            message: 'Access denied: user does not belong to your franchise'
          });
        }
        where.user_id = parseInt(user_id);
      } else {
        const merchantIds = await User.findAll({
          where: { franchaise_id: currentUserId, status: 'active' },
          attributes: ['id']
        }).then(rows => rows.map(r => r.id));
        // Use Op.in so the DB can use the composite (user_id, posting_date) index
        where.user_id = { [Op.in]: [currentUserId, ...merchantIds] };
      }

    } else if (userRole === 'admin') {
      if (user_id) {
        where.user_id = parseInt(user_id);
      } else if (include_unlinked !== 'true') {
        where.user_id = { [Op.ne]: null };
      }
      // include_unlinked=true → no user_id constraint → returns unlinked rows too
    } else {
      where.user_id = currentUserId;
    }

    // ── Optional filters ─────────────────────────────────────────────────────
    if (status)       where.status       = status.toUpperCase();
    if (payment_mode) where.payment_mode = payment_mode.toUpperCase();

    // ── Pagination ────────────────────────────────────────────────────────────
    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50)); // cap at 200
    const offset   = (pageNum - 1) * limitNum;

    const { count, rows } = await RazorpayNotification.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          required: false,   // LEFT JOIN — keep unlinked rows
          attributes: ['id', 'name', 'email', 'mobile_number', 'abheepay_id', 'organization_name']
        },
        {
          model: PosMachine,
          as: 'posMachine',
          required: false,
          attributes: ['id', 'mid_number', 'tid_number', 'device_serial_number']
        }
      ],
      // Sort by actual transaction date; fall back to receipt time for null rows
      order: [
        ['posting_date', 'DESC'],
        ['createdAt',    'DESC']
      ],
      limit:  limitNum,
      offset,
      // subQuery:false avoids a double-COUNT when includes are present
      subQuery: false
    });

    const data = rows.map(n => ({
      id:                n.id,
      txn_id:            n.txn_id,
      mid:               n.mid,
      tid:               n.tid,
      amount:            n.amount,
      currency_code:     n.currency_code,
      payment_mode:      n.payment_mode,
      payment_card_type: n.payment_card_type,
      payment_card_brand:n.payment_card_brand,
      rr_number:         n.rr_number,
      device_serial:     n.device_serial,
      posting_date:      n.posting_date,
      status:            n.status,
      user_id:           n.user_id,
      pos_machine_id:    n.pos_machine_id,
      user:              n.user     || null,
      pos_machine:       n.posMachine || null,
      created_at:        n.createdAt
    }));

    res.status(200).json({
      success: true,
      message: 'Razorpay notification report fetched successfully',
      count,
      pagination: {
        total:      count,
        page:       pageNum,
        limit:      limitNum,
        totalPages: Math.ceil(count / limitNum)
      },
      date_range: {
        from: fromDate.toISOString(),
        to:   toDate.toISOString()
      },
      data
    });
  } catch (error) {
    console.error('Error fetching Razorpay notification report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});


/**
 * GET /report/users
 *
 * Returns a filtered list of users for reporting purposes. This mirrors the
 * behaviour of `userController.getUsers` but lives under the `report` namespace
 * so that frontends can treat it as part of the reporting suite.
 *
 * Query params:
 *   status, role, page, limit
 *
 * Access rules:
 *   - admin: can see everyone and apply arbitrary filters
 *   - franchise: can only see users where franchaise_id === their own id
 *   - others: see only themselves (not terribly useful but included for safety)
 */
const getUserReport = asyncHandler(async (req, res) => {
  try {
    const { status, role, page = 1, limit = 10 } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    if (userRole === 'franchaise') {
      where.franchaise_id = userId;
    }

    if (status) {
      where.status = status;
    }

    if (role) {
      where.role = role;
    }

    // If non-admin and non-franchise, restrict to self for extra safety
    if (userRole !== 'admin' && userRole !== 'franchaise') {
      where.id = userId;
    }

    const { count, rows: users } = await User.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset,
      order: [['createdAt', 'DESC']],
    });

    res.status(200).json({
      success: true,
      message: 'User report fetched successfully',
      data: users,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Error fetching user report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong',
    });
  }
});

module.exports = { getPosTransactionReport, getWalletReport, getRazorpayNotificationReport, getUserReport };
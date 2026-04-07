const asyncHandler = require("express-async-handler");
const { Op } = require('sequelize');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const Transaction = require("../models/Transaction");
const WalletTransaction = require("../models/WalletTransaction");
const RazorpayNotification = require("../models/RazorpayNotification");
const Ledger = require('../models/Ledger');
const PayoutTransaction = require('../models/PayoutTransaction');const Beneficiary = require('../models/Beneficiary');
// Admin-only full notifications list
// Supports optional `source` query parameter to restrict to 'razorpay' or 'everlife' webhooks
const getAllRazorpayNotifications = asyncHandler(async (req, res) => {
  const userRole = req.user?.role;
  if (userRole !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const { page = 1, limit = 50, source } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const where = {};
  if (source) {
    where.source = source;
  }

  const { count, rows } = await RazorpayNotification.findAndCountAll({
    where,
    order: [['id', 'DESC']],
    limit: limitNum,
    offset,
    include: [
      {
        model: User,
        as: 'user',
        required: false,
        attributes: ['id', 'name', 'email', 'mobile_number']
      },
      {
        model: PosMachine,
        as: 'posMachine',
        required: false,
        attributes: ['id', 'mid_number', 'tid_number']
      }
    ],
    subQuery: false
  });

  res.status(200).json({
    success: true,
    message: 'All Razorpay notifications fetched',
    count,
    pagination: {
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum)
    },
    data: rows
  });
});

const getDateRange = (startDate, endDate) => {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

/**
 * Build a WHERE-scope object for the given user-id field based on the
 * caller's role.  Throws with .statusCode = 403 on franchise access denial.
 *
 * @param {Object} req            - Express request (req.user must be populated)
 * @param {string|null} qUserId   - user_id query param (may be undefined)
 * @param {string} fieldName      - Column to scope on (default 'user_id')
 * @returns {Promise<Object>}     - Partial WHERE clause object
 */
const buildUserScope = async (req, qUserId = null, fieldName = 'user_id') => {
  const userRole     = req.user?.role;
  const currentUserId = req.user?.id;
  const scope = {};

  if (userRole === 'merchant') {
    scope[fieldName] = currentUserId;
  } else if (userRole === 'franchaise') {
    if (qUserId) {
      const targetUser = await User.findOne({
        where: { id: qUserId, franchaise_id: currentUserId, status: 'active' }
      });
      if (!targetUser) {
        const err = new Error('Access denied: user does not belong to your franchise');
        err.statusCode = 403;
        throw err;
      }
      scope[fieldName] = parseInt(qUserId);
    } else {
      const merchantIds = await User.findAll({
        where: { franchaise_id: currentUserId, status: 'active' },
        attributes: ['id']
      }).then(rows => rows.map(r => r.id));
      scope[fieldName] = { [Op.in]: [currentUserId, ...merchantIds] };
    }
  } else if (userRole === 'admin') {
    if (qUserId) scope[fieldName] = parseInt(qUserId);
    // admin without user_id → no restriction
  } else {
    scope[fieldName] = currentUserId;
  }

  return scope;
};

const getPosTransactionReport = asyncHandler(async (req, res) => {
     try {
    const {
      from_date,
      to_date,
      status,
      cardHolderName,
      posTxnNo,
      deviceNo,
    } = req.query;

    const today = new Date();
    const fromDate = from_date ? new Date(from_date) : new Date(today);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = to_date ? new Date(to_date) : new Date(today);
    toDate.setHours(23, 59, 59, 999);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const whereClause = {
      Date: { [Op.between]: [fromDate, toDate] }
    };

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
      date_range: { from: fromDate.toISOString(), to: toDate.toISOString() },
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
    const { userId, from_date, to_date } = req.query;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // Fetch the user and current wallet balance
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const today = new Date();
    const fromDate = from_date ? new Date(from_date) : new Date(today);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = to_date ? new Date(to_date) : new Date(today);
    toDate.setHours(23, 59, 59, 999);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    let whereClause = {};
    if (user.role !== "admin") {
      whereClause = {
        requested_by: userId,
        // status: "completed",
      };
    }

    whereClause.createdAt = { [Op.between]: [fromDate, toDate] };

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
      date_range: { from: fromDate.toISOString(), to: toDate.toISOString() },
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
 *  from_date      – ISO date string (inclusive, default: today)
 *  to_date        – ISO date string (inclusive, extended to 23:59:59, default: today)
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
      from_date,
      to_date,
      status,
      payment_mode,
      source,
      include_unlinked = 'false',
      page = 1,
      limit = 50
    } = req.query;

    // ── Date range — defaults to today when not supplied ─────────────────────
    const today = new Date();

    const fromDate = from_date ? new Date(from_date) : new Date(today);
    fromDate.setHours(0, 0, 0, 0);

    const toDate = to_date ? new Date(to_date) : new Date(today);
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
        message: 'from_date must not be after to_date'
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

    // Bulk-fetch Ledger entries for balance figures (pos_charge = final debit row)
    const txnIds = rows.map(n => n.txn_id).filter(Boolean);
    const razorpayLedgerRows = txnIds.length
      ? await Ledger.findAll({
          where: {
            transaction_id: { [Op.in]: txnIds },
            transaction_type: 'pos_charge'
          },
          attributes: ['transaction_id', 'balance_before', 'balance', 'debit']
        })
      : [];
    const razorpayLedgerMap = {};
    razorpayLedgerRows.forEach(l => { razorpayLedgerMap[l.transaction_id] = l; });

    const data = rows.map(n => {
      const ledger = razorpayLedgerMap[n.txn_id] || null;
      return {
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
        user:              n.user        || null,
        pos_machine:       n.posMachine  || null,
        created_at:        n.createdAt,
        balance_before:    ledger ? parseFloat(ledger.balance_before) : null,
        balance_after:     ledger ? parseFloat(ledger.balance)        : null
      };
    });

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

const getLedgerReport = asyncHandler(async (req, res) => {
  try {
    const userRole = req.user?.role;
    const currentUserId = req.user?.id;
    const { from_date, to_date, user_id, status } = req.query;

    // status filter is intentionally ignored for ledger report (show all statuses)
    // because payout entries may be pending/failed and should still be visible.
    if (status) {
      // no-op intentionally
    }

    // default date range = today
    const today = new Date();
    const fromDate = from_date ? new Date(from_date) : new Date(today);
    fromDate.setHours(0, 0, 0, 0);

    const toDate = to_date ? new Date(to_date) : new Date(today);
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
        message: 'from_date must not be after to_date'
      });
    }

    const where = {
      createdAt: { [Op.between]: [fromDate, toDate] }
    };

    // scope by role
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
        where.user_id = { [Op.in]: [currentUserId, ...merchantIds] };
      }
    } else if (userRole === 'admin') {
      if (user_id) {
        where.user_id = parseInt(user_id);
      }
      // admin without user_id sees all entries
    } else {
      where.user_id = currentUserId;
    }

    const entries = await Ledger.findAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          required: false,
          attributes: ['id', 'name', 'mobile_number', 'abheepay_id', 'organization_name']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    const data = entries.map(e => ({
      id:              e.id,
      date:            e.createdAt,
      user_id:         e.user_id,
      user:            e.user || null,
      transaction_type:e.transaction_type,
      description:     e.description,
      debit:           parseFloat(e.debit)  || 0,
      credit:          parseFloat(e.credit) || 0,
      amount:          parseFloat(e.debit) > 0 ? parseFloat(e.debit) : parseFloat(e.credit),
      balance_before:  parseFloat(e.balance_before) || 0,
      balance_after:   parseFloat(e.balance)        || 0,
      transaction_id:  e.transaction_id,
      reference_id:    e.reference_id,
      reference_table: e.reference_table,
      status:          e.status,
      metadata:        e.metadata ? (() => { try { return JSON.parse(e.metadata); } catch (_) { return e.metadata; } })() : null
    }));

    res.status(200).json({
      success: true,
      message: 'Ledger report fetched successfully',
      count: entries.length,
      data
    });
  } catch (error) {
    console.error('Error fetching ledger report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

/**
 * GET /report/payout
 * Payout transaction report with balance_before / balance_after from Ledger.
 * Query: from_date, to_date, user_id, status, page, limit
 */
const getPayoutReport = asyncHandler(async (req, res) => {
  try {
    const { from_date, to_date, user_id, status, page = 1, limit = 50 } = req.query;

    const today = new Date();
    const fromDate = from_date ? new Date(from_date) : new Date(today);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = to_date ? new Date(to_date) : new Date(today);
    toDate.setHours(23, 59, 59, 999);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const where = { createdAt: { [Op.between]: [fromDate, toDate] } };

    // PayoutTransaction uses merchant_id, not user_id
    try {
      const scope = await buildUserScope(req, user_id, 'merchant_id');
      Object.assign(where, scope);
    } catch (scopeErr) {
      return res.status(scopeErr.statusCode || 403).json({ success: false, message: scopeErr.message });
    }

    if (status) where.status = status.toUpperCase();

    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset   = (pageNum - 1) * limitNum;

    const { count, rows: payouts } = await PayoutTransaction.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: limitNum,
      offset
    });

    // Bulk-fetch matching Ledger entries for balance figures
    const payoutIds = payouts.map(p => p.id);
    const payoutLedgerRows = payoutIds.length
      ? await Ledger.findAll({
          where: {
            reference_table: 'PayoutTransactions',
            reference_id: { [Op.in]: payoutIds },
            transaction_type: 'payout'
          },
          attributes: ['reference_id', 'balance_before', 'balance', 'debit']
        })
      : [];
    const payoutLedgerMap = {};
    payoutLedgerRows.forEach(l => { payoutLedgerMap[l.reference_id] = l; });

    const merchantIds = [...new Set(payouts.map(p => p.merchant_id).filter(Boolean))];
    const beneficiaryIds = [...new Set(payouts.map(p => p.beneficiary_id).filter(Boolean))];

    const [merchants, beneficiaries] = await Promise.all([
      merchantIds.length
        ? User.findAll({
            where: { id: { [Op.in]: merchantIds } },
            attributes: ['id', 'name', 'email', 'mobile_number']
          })
        : [],
      beneficiaryIds.length
        ? Beneficiary.findAll({
            where: { id: { [Op.in]: beneficiaryIds } },
            attributes: ['id', 'beneficiary_name', 'account_number', 'ifsc_code', 'bank_name', 'mobile_number', 'email', 'status']
          })
        : []
    ]);

    const merchantMap = Object.fromEntries(merchants.map(m => [m.id, m]));
    const beneficiaryMap = Object.fromEntries(beneficiaries.map(b => [b.id, b]));

    const data = payouts.map(p => {
      const ledger = payoutLedgerMap[p.id] || null;
      return {
        id:             p.id,
        date:           p.createdAt,
        merchant_id:    p.merchant_id,
        merchant:       merchantMap[p.merchant_id] || null,
        beneficiary_id: p.beneficiary_id,
        beneficiary:    beneficiaryMap[p.beneficiary_id] || null,
        reference_id:   p.reference_id,
        amount:         parseFloat(p.amount),
        service_charge: parseFloat(p.service_charge) || 0,
        total_deducted: parseFloat(p.amount) + (parseFloat(p.service_charge) || 0),
        purpose:        p.purpose,
        status:         p.status,
        balance_before: ledger ? parseFloat(ledger.balance_before) : null,
        balance_after:  ledger ? parseFloat(ledger.balance)        : null
      };
    });

    res.status(200).json({
      success: true,
      message: 'Payout report fetched successfully',
      count,
      pagination: { total: count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum) },
      date_range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      data
    });
  } catch (error) {
    console.error('Error fetching payout report:', error);
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

/**
 * GET /report/bbps
 * BBPS CC bill payment report sourced from Ledger (transaction_type='bbps_payment').
 * Query: from_date, to_date, user_id, page, limit
 */
const getBbpsReport = asyncHandler(async (req, res) => {
  try {
    const { from_date, to_date, user_id, page = 1, limit = 50 } = req.query;

    const today = new Date();
    const fromDate = from_date ? new Date(from_date) : new Date(today);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = to_date ? new Date(to_date) : new Date(today);
    toDate.setHours(23, 59, 59, 999);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const where = {
      transaction_type: 'bbps_payment',
      createdAt: { [Op.between]: [fromDate, toDate] }
    };

    try {
      const scope = await buildUserScope(req, user_id, 'user_id');
      Object.assign(where, scope);
    } catch (scopeErr) {
      return res.status(scopeErr.statusCode || 403).json({ success: false, message: scopeErr.message });
    }

    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset   = (pageNum - 1) * limitNum;

    const { count, rows: entries } = await Ledger.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          required: false,
          attributes: ['id', 'name', 'mobile_number', 'abheepay_id', 'organization_name']
        }
      ],
      order:  [['createdAt', 'DESC']],
      limit:  limitNum,
      offset,
      subQuery: false
    });

    const data = entries.map(e => {
      let meta = {};
      try { meta = e.metadata ? JSON.parse(e.metadata) : {}; } catch (_) {}
      return {
        id:              e.id,
        date:            e.createdAt,
        user_id:         e.user_id,
        user:            e.user || null,
        biller_id:       meta.biller_id       || null,
        customer_mobile: meta.customer_mobile  || null,
        payment_mode:    meta.payment_mode     || null,
        statuscode:      meta.statuscode       || null,
        external_ref:    e.transaction_id,
        description:     e.description,
        amount:          parseFloat(e.debit)          || 0,
        balance_before:  parseFloat(e.balance_before) || 0,
        balance_after:   parseFloat(e.balance)        || 0,
        status:          e.status
      };
    });

    res.status(200).json({
      success: true,
      message: 'BBPS report fetched successfully',
      count,
      pagination: { total: count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum) },
      date_range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      data
    });
  } catch (error) {
    console.error('Error fetching BBPS report:', error);
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

/**
 * GET /report/all-transactions
 * Combined Razorpay + Payout + BBPS + Direct Transfer report sourced entirely
 * from the Ledger table, ordered by createdAt DESC.
 * Every row contains: balance_before, amount (debit or credit), balance_after.
 *
 * Query: from_date, to_date, user_id, transaction_type, page, limit
 */
const getAllTransactionsReport = asyncHandler(async (req, res) => {
  try {
    const { from_date, to_date, user_id, transaction_type, page = 1, limit = 50 } = req.query;

    const today = new Date();
    const fromDate = from_date ? new Date(from_date) : new Date(today);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = to_date ? new Date(to_date) : new Date(today);
    toDate.setHours(23, 59, 59, 999);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const MONEY_TYPES = [
      'pos_credit', 'pos_charge', 'razorpay_commission',
      'payout', 'bbps_payment', 'direct_transfer',
      'wallet_credit', 'wallet_debit'
    ];

    const where = {
      transaction_type: transaction_type
        ? { [Op.in]: [transaction_type] }
        : { [Op.in]: MONEY_TYPES },
      createdAt: { [Op.between]: [fromDate, toDate] }
    };

    try {
      const scope = await buildUserScope(req, user_id, 'user_id');
      Object.assign(where, scope);
    } catch (scopeErr) {
      return res.status(scopeErr.statusCode || 403).json({ success: false, message: scopeErr.message });
    }

    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset   = (pageNum - 1) * limitNum;

    const { count, rows: entries } = await Ledger.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          required: false,
          attributes: ['id', 'name', 'mobile_number', 'abheepay_id', 'organization_name']
        }
      ],
      order:  [['createdAt', 'DESC']],
      limit:  limitNum,
      offset,
      subQuery: false
    });

    const data = entries.map(e => ({
      id:               e.id,
      date:             e.createdAt,
      user_id:          e.user_id,
      user:             e.user || null,
      transaction_type: e.transaction_type,
      description:      e.description,
      debit:            parseFloat(e.debit)           || 0,
      credit:           parseFloat(e.credit)          || 0,
      amount:           parseFloat(e.debit) > 0
                          ? parseFloat(e.debit)
                          : parseFloat(e.credit),
      balance_before:   parseFloat(e.balance_before)  || 0,
      balance_after:    parseFloat(e.balance)          || 0,
      transaction_id:   e.transaction_id,
      reference_id:     e.reference_id,
      reference_table:  e.reference_table,
      status:           e.status
    }));

    res.status(200).json({
      success: true,
      message: 'All transactions report fetched successfully',
      count,
      pagination: { total: count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum) },
      date_range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      supported_types: MONEY_TYPES,
      data
    });
  } catch (error) {
    console.error('Error fetching all transactions report:', error);
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

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

module.exports = {
  getPosTransactionReport,
  getWalletReport,
  getRazorpayNotificationReport,
  getLedgerReport,
  getPayoutReport,
  getBbpsReport,
  getAllTransactionsReport,
  getUserReport,
  getAllRazorpayNotifications
};

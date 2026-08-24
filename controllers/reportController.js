const asyncHandler = require("express-async-handler");
const { Op } = require('sequelize');
const { parseIstBusinessDateRange } = require('../utils/dateRange');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const Transaction = require("../models/Transaction");
const WalletTransaction = require("../models/WalletTransaction");
const RazorpayNotification = require("../models/RazorpayNotification");
const Ledger = require('../models/Ledger');
const MerchantTransactionCharge = require('../models/MerchantTransactionCharge');
const PayoutTransaction = require('../models/PayoutTransaction');
const Beneficiary = require('../models/Beneficiary');
const CcBillPayment = require('../models/CcBillPayment');
const { WEBHOOK_SOURCES, LEGACY_AGRO_SOURCE, extractCardClassification } = require('../utils/razorpay/sources');

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function maskMobileNumber(mobile) {
  if (!mobile) return "";
  const str = String(mobile).trim();
  if (str.length <= 4) return str;
  return "*".repeat(str.length - 4) + str.slice(-4);
}

function maskCardNumber(rawValue) {
  const raw = pickFirstNonEmpty(rawValue);
  if (!raw) return null;

  const digitsOnly = raw.replace(/\D/g, '');
  if (digitsOnly.length < 4) return null;

  const last4 = digitsOnly.slice(-4);

  // If upstream already sent a masked PAN, keep it masked while normalizing X/x to *.
  if (/[*Xx]/.test(raw) && digitsOnly.length <= 4) {
    return raw.replace(/[Xx]/g, '*');
  }

  return `${'*'.repeat(Math.max(0, digitsOnly.length - 4))}${last4}`;
}
function buildSourceFilter(source) {
  if (!source) return null;

  if (source === WEBHOOK_SOURCES.AGRO_AXIS || source === LEGACY_AGRO_SOURCE) {
    return { [Op.in]: [WEBHOOK_SOURCES.AGRO_AXIS, LEGACY_AGRO_SOURCE] };
  }

  return source;
}

// Admin-only full notifications list
// Supports optional `source` query parameter to restrict to a specific webhook source
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
    where.source = buildSourceFilter(source);
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

const safeParseJsonObject = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeProviderFieldValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
};

const findFirstNestedValue = (source, candidateKeys) => {
  if (!source || typeof source !== 'object') return null;

  const queue = [source];
  const seen = new Set();
  const normalizedCandidates = new Set(candidateKeys.map((key) => key.toLowerCase()));

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    for (const [key, value] of Object.entries(current)) {
      if (normalizedCandidates.has(String(key).toLowerCase())) {
        const normalized = normalizeProviderFieldValue(value);
        if (normalized) return normalized;
      }

      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return null;
};

const extractPayoutReferenceFields = (payout) => {
  const sources = [
    safeParseJsonObject(payout?.callback_data),
    safeParseJsonObject(payout?.data),
  ].filter(Boolean);

  const rrnKeys = ['rrn'];
  const utrKeys = ['utr', 'bankRefNo', 'bankReferenceNo', 'utrNo', 'utr_no'];

  let finalRrn = null;
  let finalUtr = null;

  for (const source of sources) {
    const rrn = findFirstNestedValue(source, rrnKeys);
    const utr = findFirstNestedValue(source, utrKeys);

    if (rrn && !finalRrn) finalRrn = rrn;
    if (utr && !finalUtr) finalUtr = utr;
  }

  // Fallback: If RRN is missing, use UTR as RRN (needed for providers like NDIA5 where bank response is UTR)
  if (!finalRrn) {
    finalRrn = finalUtr;
  }

  return {
    rrn: finalRrn || null,
    utr: finalUtr || null,
  };
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

    const parsedDateRange = parseIstBusinessDateRange(from_date, to_date);
    if (parsedDateRange.error) {
      return res.status(400).json({ success: false, message: parsedDateRange.error });
    }
    const { fromDate, toDate } = parsedDateRange;

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

    const parsedDateRange = parseIstBusinessDateRange(from_date, to_date);
    if (parsedDateRange.error) {
      return res.status(400).json({ success: false, message: parsedDateRange.error });
    }
    const { fromDate, toDate } = parsedDateRange;

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
      user_search,
      user_query,
      from_date,
      to_date,
      status,
      payment_mode,
      settlement_type,
      source,
      include_unlinked = 'false',
      page = 1,
      limit = 50
    } = req.query;

    // ── Date range — defaults to today when not supplied ─────────────────────
    const parsedDateRange = parseIstBusinessDateRange(from_date, to_date);
    if (parsedDateRange.error) {
      return res.status(400).json({ success: false, message: parsedDateRange.error });
    }
    const { fromDate, toDate } = parsedDateRange;

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

    // ── User Search Filter (ID / Name / Mobile / Abheepay ID) ───────────────
    const rawUserSearch = user_search || user_query;
    if (rawUserSearch && String(rawUserSearch).trim() !== '') {
      const queryStr = String(rawUserSearch).trim();
      const userConditions = [
        { name: { [Op.like]: `%${queryStr}%` } },
        { mobile_number: { [Op.like]: `%${queryStr}%` } },
        { abheepay_id: { [Op.like]: `%${queryStr}%` } },
      ];
      if (!isNaN(queryStr) && Number.isInteger(Number(queryStr))) {
        userConditions.push({ id: parseInt(queryStr, 10) });
      }

      const matchedUsers = await User.findAll({
        where: { [Op.or]: userConditions },
        attributes: ['id']
      });

      const matchedIds = matchedUsers.map(u => u.id);
      if (matchedIds.length > 0) {
        if (typeof where.user_id === 'number') {
          where.user_id = matchedIds.includes(where.user_id) ? where.user_id : -1;
        } else if (where.user_id && Array.isArray(where.user_id[Op.in])) {
          const allowed = where.user_id[Op.in].filter(id => matchedIds.includes(id));
          where.user_id = allowed.length > 0 ? { [Op.in]: allowed } : -1;
        } else {
          where.user_id = { [Op.in]: matchedIds };
        }
      } else {
        where.user_id = -1;
      }
    }

    // ── Optional filters ─────────────────────────────────────────────────────
    if (status)          where.status          = status.toUpperCase();
    if (payment_mode)    where.payment_mode    = payment_mode.toUpperCase();
    if (settlement_type) where.settlement_type = settlement_type;
    if (source)          where.source          = buildSourceFilter(source);

    // ── Pagination ────────────────────────────────────────────────────────────
    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const rawLimit = parseInt(limit) || 50;
    const rangeMs = toDate.getTime() - fromDate.getTime();
    const rangeDays = rangeMs / (24 * 60 * 60 * 1000);
    const useUnlimited = rangeDays > 1;
    const limitNum = useUnlimited
      ? null
      : Math.min(1000, Math.max(1, rawLimit)); // cap at 1000 for 1-day or less
    const offset   = useUnlimited ? null : (pageNum - 1) * limitNum;

    const { count, rows } = await RazorpayNotification.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          required: false,   // LEFT JOIN — keep unlinked rows
          attributes: ['id', 'name', 'email', 'mobile_number', 'abheepay_id', 'organization_name', 'franchaise_id', 'settlement_type']
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
      ...(useUnlimited ? {} : { limit: limitNum, offset }),
      // subQuery:false avoids a double-COUNT when includes are present
      subQuery: false
    });

    const franchiseIds = [...new Set(rows
      .map((row) => row?.user?.franchaise_id)
      .filter((value) => value !== null && value !== undefined)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0))];

    const franchiseUsers = franchiseIds.length
      ? await User.findAll({
          where: {
            id: { [Op.in]: franchiseIds },
            role: { [Op.in]: ['franchaise', 'franchise'] },
          },
          attributes: ['id', 'name', 'abheepay_id'],
        })
      : [];

    const franchiseMap = new Map(franchiseUsers.map((franchise) => {
      const plainFranchise = franchise?.toJSON ? franchise.toJSON() : franchise;
      return [
        Number(plainFranchise.id),
        {
          id: Number(plainFranchise.id),
          name: plainFranchise.name || null,
          abheepay_id: plainFranchise.abheepay_id || null,
        },
      ];
    }));

    // Bulk-fetch Ledger entries for balance figures (pos_charge = final debit row)
    const txnIds = rows.map(n => n.txn_id).filter(Boolean);
    const razorpayLedgerRows = txnIds.length
      ? await Ledger.findAll({
          where: {
            transaction_id: { [Op.in]: txnIds },
            transaction_type: 'pos_charge'
          },
          attributes: ['transaction_id', 'balance_before', 'balance', 'debit', 'metadata']
        })
      : [];
    const razorpayLedgerMap = {};
    razorpayLedgerRows.forEach(l => { razorpayLedgerMap[l.transaction_id] = l; });
    const chargeRows = txnIds.length
      ? await MerchantTransactionCharge.findAll({
          where: {
            razorpay_transaction_id: { [Op.in]: txnIds }
          },
          attributes: ['razorpay_transaction_id', 'customer_name']
        })
      : [];
    const chargeMap = {};
    chargeRows.forEach((charge) => {
      chargeMap[charge.razorpay_transaction_id] = charge;
    });

    const data = rows.map(n => {
      const ledger = razorpayLedgerMap[n.txn_id] || null;
      const charge = chargeMap[n.txn_id] || null;
      const eventData = (() => {
        if (!n.event_json) return null;
        if (typeof n.event_json === 'object') return n.event_json;
        try {
          return JSON.parse(n.event_json);
        } catch (_) {
          return null;
        }
      })();
      const authCode = eventData?.authCode || eventData?.auth_code || null;
      const rrNumber = eventData?.rrNumber || eventData?.rr_number || n.rr_number || null;
      const cardClassification = extractCardClassification(eventData);
      const paymentCardType = eventData?.paymentCardType || eventData?.payment_card_type || n.payment_card_type || null;
      const ledgerMeta = ledger?.metadata ? (() => { try { return JSON.parse(ledger.metadata); } catch (_) { return ledger.metadata; } })() : null;
      const mdr = ledger ? parseFloat(ledger.debit) : null;
      const netCredit = ledgerMeta?.net_amount !== undefined ? parseFloat(ledgerMeta.net_amount) : null;
      const mdrPercent = ledgerMeta?.charge_rate !== undefined ? parseFloat(ledgerMeta.charge_rate) : null;
      const balanceAfterMdr = ledger ? parseFloat(ledger.balance) : null;
      const franchiseId = n.user?.franchaise_id ? Number(n.user.franchaise_id) : null;
      const franchise = franchiseId ? franchiseMap.get(franchiseId) || null : null;
      const cardHolderName = pickFirstNonEmpty(
        eventData?.cardHolderName,
        eventData?.card_holder_name,
        eventData?.holder_name,
        eventData?.customerName,
        eventData?.customer_name,
        eventData?.payerName,
        charge?.customer_name
      );
      const maskedCardNumber = maskCardNumber(
        pickFirstNonEmpty(
          eventData?.formattedPan,
          eventData?.maskedCardNumber,
          eventData?.masked_card_number,
          eventData?.paymentCardNumber,
          eventData?.payment_card_number,
          eventData?.cardNumber,
          eventData?.card_number,
          eventData?.pan
        )
      );

      let userObj = null;
      if (n.user) {
        userObj = n.user.toJSON ? n.user.toJSON() : { ...n.user };
        const actualRole = req.user?.original_role || req.user?.role;
        const isEmployeeUser = actualRole && String(actualRole).toLowerCase() === 'employee';
        if (isEmployeeUser) {
          userObj.mobile_number = maskMobileNumber(userObj.mobile_number);
        }
      }

      return {
        id:                n.id,
        txn_id:            n.txn_id,
        mid:               n.mid,
        tid:               n.tid,
        amount:            n.amount,
        currency_code:     n.currency_code,
        payment_mode:      n.payment_mode,
        payment_card_type: n.payment_card_type,
        paymentCardType,
        payment_card_brand:n.payment_card_brand,
        rr_number:         n.rr_number,
        authCode,
        rrNumber,
        cardClassification,
        card_holder_name:  cardHolderName,
        cardHolderName,
        holder_name:       cardHolderName,
        customer_name:     cardHolderName,
        card_number:       maskedCardNumber,
        masked_card_number: maskedCardNumber,
        payment_card_number: maskedCardNumber,
        card_no:           maskedCardNumber,
        pan:               maskedCardNumber,
        device_serial:     n.device_serial,
        posting_date:      n.posting_date,
        status:            n.status,
        source:            n.source || null,
        settlement_type:   n.settlement_type || null,
        user_id:           n.user_id,
        pos_machine_id:    n.pos_machine_id,
        user:              userObj,
        franchise_id:      franchiseId,
        franchise_name:    franchise?.name || null,
        franchise,
        pos_machine:       n.posMachine  || null,
        created_at:        n.createdAt,
        balance_before:    ledger ? parseFloat(ledger.balance_before) : null,
        balance_after:     ledger ? parseFloat(ledger.balance)        : null,
        mdr,
        mdr_percent:       mdrPercent,
        net_credit:        netCredit,
        balance_after_mdr: balanceAfterMdr,
        remaining_balance: netCredit, // per-txn net credit after MDR cut
        remaining_balance_1: netCredit,
        remaining_balance_2: netCredit
      };
    });

    res.status(200).json({
      success: true,
      message: 'Razorpay notification report fetched successfully',
      count,
      pagination: useUnlimited ? null : {
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
    const { from_date, to_date, user_id, status, transaction_type } = req.query;

    // status filter is intentionally ignored for ledger report (show all statuses)
    // because payout entries may be pending/failed and should still be visible.
    if (status) {
      // no-op intentionally
    }

    const parsedDateRange = parseIstBusinessDateRange(from_date, to_date);
    if (parsedDateRange.error) {
      return res.status(400).json({ success: false, message: parsedDateRange.error });
    }
    const { fromDate, toDate } = parsedDateRange;

    const where = {
      createdAt: { [Op.between]: [fromDate, toDate] }
    };

    if (transaction_type) {
      const types = String(transaction_type).split(',').map(t => t.trim()).filter(Boolean);
      if (types.length === 1) {
        where.transaction_type = types[0];
      } else if (types.length > 1) {
        where.transaction_type = { [Op.in]: types };
      }
    }

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

    const RazorpayNotification = require("../models/RazorpayNotification");

    // Collect ALL transaction_ids that don't already have RRN embedded in description
    const txnIdsNeedingRrn = entries
      .filter(e => e.transaction_id && !(e.description && e.description.includes('| RRN:')))
      .map(e => e.transaction_id);

    let notificationMap = {};
    if (txnIdsNeedingRrn.length > 0) {
      const notifications = await RazorpayNotification.findAll({
        where: { txn_id: { [Op.in]: txnIdsNeedingRrn } }
      });
      for (const notif of notifications) {
        let rrNumber = notif.rr_number;
        if (!rrNumber && notif.event_json) {
          try {
            const eventData = typeof notif.event_json === 'string' ? JSON.parse(notif.event_json) : notif.event_json;
            rrNumber = eventData.rrNumber || null;
          } catch(e) {}
        }
        if (rrNumber || notif.txn_id) {
          notificationMap[notif.txn_id] = rrNumber || null;
        }
      }
    }

    const data = entries.map(e => {
      let description = e.description;
      // For franchise earning entries that don't already have RRN in description, append it
      if (e.transaction_type === 'pos_franchise_earning' && description && !description.includes('| RRN:') && notificationMap[e.transaction_id]) {
        description = `${description} | Txn: ${e.transaction_id} | RRN: ${notificationMap[e.transaction_id]}`;
      }

      let userObj = null;
      if (e.user) {
        userObj = e.user.toJSON ? e.user.toJSON() : { ...e.user };
        const actualRole = req.user?.original_role || req.user?.role;
        const isEmployeeUser = actualRole && String(actualRole).toLowerCase() === 'employee';
        if (isEmployeeUser) {
          userObj.mobile_number = maskMobileNumber(userObj.mobile_number);
        }
      }

      // Resolve RRN: prefer embedded in description, fall back to notification lookup
      let rr_number = null;
      const rrnInDesc = description && description.match(/RRN\s*:\s*([^|\n]+)/i);
      if (rrnInDesc && rrnInDesc[1]) {
        rr_number = rrnInDesc[1].trim();
      } else if (e.transaction_id && notificationMap[e.transaction_id]) {
        rr_number = notificationMap[e.transaction_id];
      }

      return {
      id:              e.id,
      date:            e.createdAt,
      user_id:         e.user_id,
      user:            userObj,
      transaction_type:e.transaction_type,
      description:     description,
      rr_number,
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
    };
    });


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

    const parsedDateRange = parseIstBusinessDateRange(from_date, to_date);
    if (parsedDateRange.error) {
      return res.status(400).json({ success: false, message: parsedDateRange.error });
    }
    const { fromDate, toDate } = parsedDateRange;

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
    
    const payoutIds = payouts.map(p => p.id);
    const payoutLedgerRows = payoutIds.length
      ? await Ledger.findAll({
          where: {
            reference_table: 'PayoutTransactions',
            reference_id: { [Op.in]: payoutIds },
            transaction_type: { [Op.in]: ['payout', 'payout_refund'] }
          },
          attributes: ['id', 'reference_id', 'transaction_type', 'balance_before', 'balance', 'debit', 'credit', 'createdAt']
        })
      : [];
    const payoutLedgerMap = {};
    payoutLedgerRows.forEach((ledgerRow) => {
      const key = ledgerRow.reference_id;
      if (!payoutLedgerMap[key]) {
        payoutLedgerMap[key] = [];
      }
      payoutLedgerMap[key].push(ledgerRow);
    });

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

    const actualRole = req.user?.original_role || req.user?.role;
    const isEmployeeUser = actualRole && String(actualRole).toLowerCase() === 'employee';
    let finalMerchants = merchants;
    if (isEmployeeUser) {
      finalMerchants = merchants.map(m => {
        const plain = m.toJSON ? m.toJSON() : { ...m };
        plain.mobile_number = maskMobileNumber(plain.mobile_number);
        return plain;
      });
    }

    const merchantMap = Object.fromEntries(finalMerchants.map(m => [m.id, m]));
    const beneficiaryMap = Object.fromEntries(beneficiaries.map(b => [b.id, b]));

    const data = payouts.map(p => {
      const referenceFields = extractPayoutReferenceFields(p);
      const ledgerEntries = (payoutLedgerMap[p.id] || []).slice().sort((a, b) => {
        const timeDiff = new Date(a.createdAt) - new Date(b.createdAt);
        if (timeDiff !== 0) return timeDiff;
        return (a.id || 0) - (b.id || 0);
      });
      const initialLedger = ledgerEntries.find((entry) => entry.transaction_type === 'payout') || ledgerEntries[0] || null;
      const finalLedger = ledgerEntries[ledgerEntries.length - 1] || initialLedger;
      const isRefunded = ledgerEntries.some(e => e.transaction_type === 'payout_refund');
      return {
        id:             p.id,
        date:           p.createdAt,
        merchant_id:    p.merchant_id,
        merchant:       merchantMap[p.merchant_id] || null,
        beneficiary_id: p.beneficiary_id,
        beneficiary:    beneficiaryMap[p.beneficiary_id] || null,
        reference_id:   p.reference_id,
        payout_provider: p.payout_provider,
        amount:         parseFloat(p.amount),
        service_charge: parseFloat(p.service_charge) || 0,
        total_deducted: parseFloat(p.amount) + (parseFloat(p.service_charge) || 0),
        purpose:        p.purpose,
        status:         p.status,
        data:           p.data,
        rrn:            referenceFields.rrn,
        utr:            referenceFields.utr,
        balance_before: initialLedger ? parseFloat(initialLedger.balance_before) : null,
        balance_after:  finalLedger ? parseFloat(finalLedger.balance)        : null,
        is_refunded:    isRefunded
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
    const { from_date, to_date, user_id, user_search, user_query, status, page = 1, limit = 50 } = req.query;

    const parsedDateRange = parseIstBusinessDateRange(from_date, to_date);
    if (parsedDateRange.error) {
      return res.status(400).json({ success: false, message: parsedDateRange.error });
    }
    const { fromDate, toDate } = parsedDateRange;

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

    const userSearch = pickFirstNonEmpty(user_search, user_query);
    if (userSearch) {
      const matchedUsers = await User.findAll({
        where: {
          [Op.or]: [
            { name: { [Op.like]: `%${userSearch}%` } },
            { mobile_number: { [Op.like]: `%${userSearch}%` } },
            { abheepay_id: { [Op.like]: `%${userSearch}%` } },
            ...(Number.isInteger(Number(userSearch)) ? [{ id: Number(userSearch) }] : [])
          ]
        },
        attributes: ['id']
      });
      const matchedIds = matchedUsers.map(u => u.id);
      if (where.user_id && typeof where.user_id === 'object' && Array.isArray(where.user_id[Op.in])) {
        const existingIds = new Set(where.user_id[Op.in]);
        const intersected = matchedIds.filter(id => existingIds.has(id));
        where.user_id = intersected.length > 0 ? { [Op.in]: intersected } : -1;
      } else {
        where.user_id = matchedIds.length > 0 ? { [Op.in]: matchedIds } : -1;
      }
    }

    if (status) {
      const sUpper = String(status).trim().toUpperCase();
      let statusWhere = {};
      if (sUpper === 'SUCCESS') {
        statusWhere = {
          [Op.or]: [
            { statuscode: { [Op.in]: ['TXN', 'TUP'] } },
            { status: { [Op.like]: '%success%' } }
          ]
        };
      } else if (sUpper === 'PENDING') {
        statusWhere = {
          [Op.or]: [
            { statuscode: { [Op.in]: ['PEN', 'PENDING', 'PROCESSING', 'INP', 'INIT', 'INITIATED'] } },
            { status: { [Op.like]: '%pend%' } },
            { status: { [Op.like]: '%process%' } }
          ]
        };
      } else if (sUpper === 'FAILED') {
        statusWhere = {
          [Op.or]: [
            { statuscode: { [Op.notIn]: ['TXN', 'TUP', 'PEN', 'PENDING', 'PROCESSING', 'INP', 'INIT', 'INITIATED'] } },
            { status: { [Op.like]: '%fail%' } },
            { status: { [Op.like]: '%error%' } }
          ]
        };
      }
      const matchedPayments = await CcBillPayment.findAll({
        where: statusWhere,
        attributes: ['id']
      });
      const matchedPaymentIds = matchedPayments.map(p => p.id);
      where.reference_id = matchedPaymentIds.length > 0 ? { [Op.in]: matchedPaymentIds } : -1;
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

    const bbpsPaymentIds = [...new Set(entries
      .filter((entry) => {
        const referenceTable = entry.reference_table || entry.referenceTable || null;
        return !!entry.reference_id && (!referenceTable || referenceTable === 'CcBillPayments');
      })
      .map((entry) => entry.reference_id))];

    const paymentRecords = bbpsPaymentIds.length
      ? await CcBillPayment.findAll({
          where: { id: { [Op.in]: bbpsPaymentIds } },
          attributes: ['id', 'biller_id', 'customer_mobile', 'payment_mode', 'statuscode', 'status', 'external_ref']
        })
      : [];

    const paymentMap = Object.fromEntries(paymentRecords.map((payment) => [payment.id, payment]));

    const data = entries.map(e => {
      let meta = {};
      try { meta = e.metadata ? JSON.parse(e.metadata) : {}; } catch (_) {}
      const payment = paymentMap[e.reference_id] || null;

      return {
        id:              e.id,
        date:            e.createdAt,
        user_id:         e.user_id,
        user:            e.user || null,
        biller_id:       payment?.biller_id || meta.biller_id || null,
        customer_mobile: payment?.customer_mobile || meta.customer_mobile || null,
        payment_mode:    payment?.payment_mode || meta.payment_mode || null,
        statuscode:      payment?.statuscode || meta.statuscode || null,
        external_ref:    payment?.external_ref || meta.external_ref || e.transaction_id || null,
        description:     e.description,
        amount:          parseFloat(e.debit)          || 0,
        balance_before:  parseFloat(e.balance_before) || 0,
        balance_after:   parseFloat(e.balance)        || 0,
        status:          payment?.status || meta.status || null,
        reference_id:    e.reference_id || null,
        reference_table: e.reference_table || null,
        metadata:        meta,
        raw_payment:     payment || null
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

    const parsedDateRange = parseIstBusinessDateRange(from_date, to_date);
    if (parsedDateRange.error) {
      return res.status(400).json({ success: false, message: parsedDateRange.error });
    }
    const { fromDate, toDate } = parsedDateRange;

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

    let data = users;
    const actualRole = req.user?.original_role || req.user?.role;
    const isEmployeeUser = actualRole && String(actualRole).toLowerCase() === 'employee';
    if (isEmployeeUser) {
      data = users.map(u => {
        const plain = u.toJSON ? u.toJSON() : { ...u };
        plain.mobile_number = maskMobileNumber(plain.mobile_number);
        return plain;
      });
    }

    res.status(200).json({
      success: true,
      message: 'User report fetched successfully',
      data,
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

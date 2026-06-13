const asyncHandler = require("express-async-handler");
const WalletTransaction = require("../models/WalletTransaction");
const User = require("../models/User");
const ledgerService = require("../services/ledgerService");
const PosMachine = require("../models/posMachine");
const { Op } = require("sequelize");

const listStatement = asyncHandler(async (req, res) => {
  try {
    const status = req.query.status;
    const searchedRole = req.query.searched_role || null;
    const userRole = req.user.role;
    const userId = req.user.id;

    const where = {
      status: status || "completed",
    };

    console.log("Role Check:", searchedRole, userRole);

    if (userRole === "admin") {
      const userFilter = {
        status: "active",
      };

      if (searchedRole) {
        userFilter.role = searchedRole;
      }

      const users = await User.findAll({
        where: userFilter,
        attributes: ["id"],
      });

      const userIds = users.map((u) => u.id);
      where.requested_by = userIds;
    }

    if (userRole === "franchaise") {
      if (searchedRole === "merchant") {
        const users = await User.findAll({
          where: { franchaise_id: userId, status: "active" },
          attributes: ["id"],
        });
        const userIds = users.map((u) => u.id);
        where.requested_by = userIds;
      } else {
        where.requested_by = userId;
      }
    }

    if (userRole === "merchant") {
      where.requested_by = userId;
    }

    const transactions = await WalletTransaction.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      count: transactions.length,
      transactions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message || "Something went wrong",
    });
  }
});

// Get ledger entries for a user with running balance
const getLedgerEntries = asyncHandler(async (req, res) => {
  try {
    const {
      user_id,
      start_date,
      end_date,
      transaction_type,
      page = 1,
      limit = 50
    } = req.query;

    const userRole = req.user?.role;
    const userId = req.user?.id;

    // Determine which user's ledger to show
    let targetUserId = user_id;

    // Role-based access control
    if (userRole === 'merchant') {
      // Merchants can only see their own ledger
      targetUserId = userId;
    } else if (userRole === 'franchaise') {
      // Franchise can see their own or their merchants' ledgers
      if (user_id) {
        // Verify that the requested user_id belongs to this franchise by checking
        // which merchants have POS machines assigned to this franchise user
        const merchantsUnderFranchise = await User.findAll({
          where: { franchaise_id: userId },
          attributes: ['id']
        });
        const assignedUserIds = merchantsUnderFranchise.map(u => u.id);
        
        if (!assignedUserIds.includes(parseInt(user_id)) && parseInt(user_id) !== userId) {
          return res.status(403).json({
            success: false,
            message: 'You do not have access to this user\'s ledger'
          });
        }
        targetUserId = user_id;
      } else {
        targetUserId = userId;
      }
    } else if (userRole === 'admin') {
      // Admin can see any user's ledger
      if (!user_id) {
        return res.status(400).json({
          success: false,
          message: 'user_id is required for admin users'
        });
      }
      targetUserId = user_id;
    } else {
      // Default: own ledger
      targetUserId = userId;
    }

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'user_id is required'
      });
    }

    // Get ledger entries
    const { entries, pagination } = await ledgerService.getLedgerEntries({
      userId: parseInt(targetUserId),
      startDate: start_date,
      endDate: end_date,
      transactionType: transaction_type,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    // Get current balance
    const currentBalance = await ledgerService.getLatestBalance(parseInt(targetUserId));
    const availableBalance = await ledgerService.getAvailableBalance(parseInt(targetUserId));

    // Fetch missing RRNs on the fly for previous franchise earning entries
    const RazorpayNotification = require("../models/RazorpayNotification");
    const franchiseEarningTxnIds = entries
      .filter(e => e.transaction_type === 'pos_franchise_earning' && e.transaction_id && e.description && !e.description.includes('| RRN:'))
      .map(e => e.transaction_id);

    let notificationMap = {};
    if (franchiseEarningTxnIds.length > 0) {
      const notifications = await RazorpayNotification.findAll({
        where: { txn_id: { [Op.in]: franchiseEarningTxnIds } }
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
          notificationMap[notif.txn_id] = rrNumber || 'N/A';
        }
      }
    }

    // Format entries with metadata parsing
    const formattedEntries = entries.map(entry => {
      let metadata = null;
      if (entry.metadata) {
        try {
          metadata = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : entry.metadata;
        } catch (e) {
          metadata = entry.metadata;
        }
      }

      const debit = parseFloat(entry.debit) || 0;
      const credit = parseFloat(entry.credit) || 0;
      const balanceBefore = parseFloat(entry.balance_before) || 0;
      const balanceAfter = parseFloat(entry.balance) || 0;

      let description = entry.description;
      if (entry.transaction_type === 'pos_franchise_earning' && description && !description.includes('| RRN:') && notificationMap[entry.transaction_id]) {
        description = `${description} | Txn: ${entry.transaction_id} | RRN: ${notificationMap[entry.transaction_id]}`;
      }

      return {
        id: entry.id,
        transaction_type: entry.transaction_type,
        transaction_id: entry.transaction_id,
        reference_id: entry.reference_id,
        reference_table: entry.reference_table,
        description: description,
        // Passbook display columns
        balance_before: balanceBefore,            // Balance Before Transaction
        debit: debit,                             // Debit  (money out)
        credit: credit,                           // Credit (money in)
        transaction_amount: debit || credit,      // Absolute transaction amount
        balance_after: balanceAfter,              // Balance After Transaction (same as "balance")
        balance: balanceAfter,                    // Alias kept for backward compatibility
        status: entry.status,
        metadata: metadata,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt
      };
    });

    // Get user details
    const user = await User.findByPk(parseInt(targetUserId), {
      attributes: ['id', 'name', 'email', 'mobile_number', 'abheepay_id', 'organization_name']
    });

    res.status(200).json({
      success: true,
      message: 'Ledger entries retrieved successfully',
      user: user ? {
        id: user.id,
        name: user.name,
        email: user.email,
        mobile_number: user.mobile_number,
        abheepay_id: user.abheepay_id,
        organization_name: user.organization_name
      } : null,
      current_balance: currentBalance,
      available_balance: availableBalance,
      data: formattedEntries,
      pagination: pagination
    });
  } catch (error) {
    console.error('Get ledger entries error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

/**
 * GET /ledger/entries/:id
 * Fetch a single ledger entry with full passbook row data plus the linked
 * source record from reference_table (WalletTransaction, MerchantTransactionCharge, etc.)
 */
const getLedgerEntryDetails = asyncHandler(async (req, res) => {
  try {
    const ledgerId = parseInt(req.params.id);
    if (!ledgerId || isNaN(ledgerId)) {
      return res.status(400).json({ success: false, message: 'Valid ledger entry id is required' });
    }

    const { entry, linkedRecord } = await ledgerService.getLedgerEntryWithLinkedRecord(ledgerId);

    if (!entry) {
      return res.status(404).json({ success: false, message: 'Ledger entry not found' });
    }

    // Role-based access: non-admin users can only read their own entries
    const userRole = req.user?.role;
    const userId = req.user?.id;

    if (userRole !== 'admin' && entry.user_id !== userId) {
      if (userRole === 'franchaise') {
        // Franchise may view their merchants' entries
        const merchant = await User.findOne({
          where: { id: entry.user_id, franchaise_id: userId }
        });
        if (!merchant) {
          return res.status(403).json({ success: false, message: 'Access denied' });
        }
      } else {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    // Parse metadata
    let metadata = null;
    if (entry.metadata) {
      try {
        metadata = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : entry.metadata;
      } catch (e) {
        metadata = entry.metadata;
      }
    }

    const debit = parseFloat(entry.debit) || 0;
    const credit = parseFloat(entry.credit) || 0;
    const balanceBefore = parseFloat(entry.balance_before) || 0;
    const balanceAfter = parseFloat(entry.balance) || 0;

    res.status(200).json({
      success: true,
      message: 'Ledger entry retrieved successfully',
      data: {
        id: entry.id,
        user: entry.user || null,
        transaction_type: entry.transaction_type,
        transaction_id: entry.transaction_id,
        reference_id: entry.reference_id,
        reference_table: entry.reference_table,
        description: entry.description,
        // Passbook / statement columns
        balance_before: balanceBefore,
        debit: debit,
        credit: credit,
        transaction_amount: debit || credit,
        balance_after: balanceAfter,
        balance: balanceAfter,
        status: entry.status,
        metadata: metadata,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt,
        // Full source record for drill-down
        linked_record: linkedRecord || null
      }
    });
  } catch (error) {
    console.error('Get ledger entry details error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

module.exports = { listStatement, getLedgerEntries, getLedgerEntryDetails };

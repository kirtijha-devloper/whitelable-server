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
      status,
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
        // Verify that the requested user_id belongs to this franchise
        const machines = await PosMachine.findAll({
          where: { franchaise_id: userId },
          attributes: ['assigned_user_id']
        });
        const assignedUserIds = machines.map(m => m.assigned_user_id).filter(Boolean);
        
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
      status: status,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    // Get current balance
    const currentBalance = await ledgerService.getLatestBalance(parseInt(targetUserId));

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

      return {
        id: entry.id,
        transaction_type: entry.transaction_type,
        transaction_id: entry.transaction_id,
        reference_id: entry.reference_id,
        description: entry.description,
        debit: parseFloat(entry.debit) || 0,
        credit: parseFloat(entry.credit) || 0,
        balance: parseFloat(entry.balance) || 0, // Running balance (remaining amount)
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
      data: formattedEntries,
      pagination: pagination
    });
  } catch (error) {
    console.error('Get ledger entries error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

module.exports = { listStatement, getLedgerEntries }
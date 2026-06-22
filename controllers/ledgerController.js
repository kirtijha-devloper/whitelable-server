const asyncHandler = require("express-async-handler");
const WalletTransaction = require("../models/WalletTransaction");
const User = require("../models/User");
const Ledger = require("../models/Ledger");
const PayoutTransaction = require("../models/PayoutTransaction");
const PayoutAuditLog = require("../models/PayoutAuditLog");
const ledgerService = require("../services/ledgerService");
const PosMachine = require("../models/posMachine");
const { Op } = require("sequelize");
const { hasPermission, EMPLOYEE_PERMISSIONS, normalizeRole } = require("../utils/permissions");

function canManageLedgerRefunds(user) {
  return normalizeRole(user?.role) === 'admin'
    || hasPermission(user, EMPLOYEE_PERMISSIONS.LEDGER_MANAGE)
    || hasPermission(user, EMPLOYEE_PERMISSIONS.PAYOUT_MANAGE);
}

async function buildManualActions(entry, metadata, currentUser) {
  const actions = {
    can_refund_sevenpay: false,
    refund_endpoint: null,
    reason: null,
  };

  if (!canManageLedgerRefunds(currentUser)) {
    actions.reason = 'admin_or_authorized_employee_required';
    return actions;
  }

  if (!entry || entry.transaction_type !== 'payout' || entry.reference_table !== 'PayoutTransactions' || !entry.reference_id) {
    actions.reason = 'not_a_payout_ledger_entry';
    return actions;
  }

  const payoutTransaction = await PayoutTransaction.findByPk(entry.reference_id, {
    attributes: ['id', 'status', 'payout_provider', 'reference_id'],
  });

  if (!payoutTransaction) {
    actions.reason = 'linked_payout_not_found';
    return actions;
  }

  if (payoutTransaction.payout_provider !== 'Sevenpay') {
    actions.reason = 'manual_refund_supported_only_for_sevenpay';
    return actions;
  }

  if (String(payoutTransaction.status || '').toUpperCase() !== 'FAILED') {
    actions.reason = 'payout_status_must_be_failed';
    return actions;
  }

  const existingRefund = await Ledger.findOne({
    where: {
      transaction_type: 'payout_refund',
      reference_id: payoutTransaction.id,
      reference_table: 'PayoutTransactions',
    },
    attributes: ['id'],
  });

  if (existingRefund) {
    actions.reason = 'refund_already_exists';
    return {
      ...actions,
      existing_refund_ledger_id: existingRefund.id,
    };
  }

  return {
    can_refund_sevenpay: true,
    refund_endpoint: `/api/ledger/entries/${entry.id}/manual-refund`,
    reason: null,
    payout_reference: payoutTransaction.reference_id,
    payout_transaction_id: payoutTransaction.id,
    payout_provider: payoutTransaction.payout_provider,
    total_refund_amount: (parseFloat(metadata?.payout_amount || 0) + parseFloat(metadata?.service_charge || 0)) || null,
  };
}

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
    const formattedEntries = await Promise.all(entries.map(async (entry) => {
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

      const manual_actions = await buildManualActions(entry, metadata, req.user);

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
        manual_actions,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt
      };
    }));

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
    const detailManualActions = await buildManualActions(entry, metadata, req.user);

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
        manual_actions: detailManualActions,
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

const manualRefundLedgerEntry = asyncHandler(async (req, res) => {
  if (!canManageLedgerRefunds(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'Admin or authorized employee access required.',
    });
  }

  const ledgerId = parseInt(req.params.id, 10);
  if (!ledgerId || isNaN(ledgerId)) {
    return res.status(400).json({
      success: false,
      message: 'Valid ledger entry id is required.',
    });
  }

  const entry = await Ledger.findByPk(ledgerId);
  if (!entry) {
    return res.status(404).json({
      success: false,
      message: 'Ledger entry not found.',
    });
  }

  if (entry.transaction_type !== 'payout' || entry.reference_table !== 'PayoutTransactions' || !entry.reference_id) {
    return res.status(400).json({
      success: false,
      message: 'This ledger entry is not eligible for manual payout refund.',
    });
  }

  const payoutTransaction = await PayoutTransaction.findByPk(entry.reference_id);
  if (!payoutTransaction) {
    return res.status(404).json({
      success: false,
      message: 'Linked payout transaction not found.',
    });
  }

  if (payoutTransaction.payout_provider !== 'Sevenpay') {
    return res.status(400).json({
      success: false,
      message: 'Manual refund from ledger is currently supported only for SevenPay payouts.',
    });
  }

  if (String(payoutTransaction.status || '').toUpperCase() !== 'FAILED') {
    return res.status(400).json({
      success: false,
      message: 'Manual refund is allowed only when the SevenPay payout status is FAILED.',
      status: payoutTransaction.status,
    });
  }

  const existingRefund = await Ledger.findOne({
    where: {
      transaction_type: 'payout_refund',
      reference_id: payoutTransaction.id,
      reference_table: 'PayoutTransactions',
    },
  });

  if (existingRefund) {
    return res.status(200).json({
      success: true,
      message: 'Refund already exists; no action taken.',
      refundCreated: false,
      existingRefundLedgerId: existingRefund.id,
      payoutTransactionId: payoutTransaction.id,
    });
  }

  let payoutMetadata = null;
  if (entry.metadata) {
    try {
      payoutMetadata = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : entry.metadata;
    } catch (_error) {
      payoutMetadata = entry.metadata;
    }
  }

  const refundAmount = parseFloat(payoutTransaction.amount || 0) + parseFloat(payoutTransaction.service_charge || 0);
  const refundEntry = await ledgerService.createLedgerEntry({
    userId: payoutTransaction.merchant_id,
    transactionType: 'payout_refund',
    referenceId: payoutTransaction.id,
    referenceTable: 'PayoutTransactions',
    description: `Manual refund for failed SevenPay payout ${payoutTransaction.reference_id}`,
    credit: refundAmount,
    metadata: {
      payout_provider: 'Sevenpay',
      payout_reference: payoutTransaction.reference_id,
      original_ledger_id: entry.id,
      original_payout_amount: payoutTransaction.amount,
      original_service_charge: payoutTransaction.service_charge,
      original_payout_metadata: payoutMetadata,
      refund_source: 'ledger_manual',
      performed_by: req.user?.id,
      performed_role: req.user?.role,
    }
  });

  let snapshot = null;
  if (payoutTransaction.data) {
    try {
      snapshot = typeof payoutTransaction.data === 'string' ? JSON.parse(payoutTransaction.data) : payoutTransaction.data;
    } catch (_error) {
      snapshot = {};
    }
  }
  snapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  snapshot.manualRefund = {
    refundedAt: new Date().toISOString(),
    refundedBy: req.user?.id || null,
    refundedRole: req.user?.role || null,
    refundLedgerId: refundEntry?.id || null,
    refundAmount,
    source: 'ledger_manual',
  };
  await payoutTransaction.update({ data: JSON.stringify(snapshot) });

  await PayoutAuditLog.create({
    payout_id: payoutTransaction.id,
    action: 'SEVENPAY_MANUAL_REFUND',
    details: {
      reference_id: payoutTransaction.reference_id,
      requestedBy: req.user?.id,
      requestedRole: req.user?.role,
      sourceLedgerId: entry.id,
      refundLedgerId: refundEntry?.id || null,
      refundAmount,
      payoutStatus: payoutTransaction.status,
    },
  });

  return res.status(200).json({
    success: true,
    message: 'SevenPay manual refund created successfully.',
    refundCreated: true,
    refundLedgerId: refundEntry?.id || null,
    refundAmount,
    payoutTransactionId: payoutTransaction.id,
  });
});

module.exports = { listStatement, getLedgerEntries, getLedgerEntryDetails, manualRefundLedgerEntry };

const Sequelize = require('sequelize');
const db = require('../config/database');

const Ledger = db.define('Ledger', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  transaction_type: {
    type: Sequelize.STRING,
    allowNull: false,
    comment: 'Type of transaction: razorpay_charge, wallet_credit, wallet_debit, payout, transfer, razorpay_commission, rental, etc.'
  },
  transaction_id: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'External transaction identifier (e.g. Razorpay txn ID, payout reference)'
  },
  reference_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'Primary key of the related record in reference_table'
  },
  reference_table: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'Table that reference_id belongs to: WalletTransactions | MerchantTransactionCharges | PayoutTransactions | Rentals'
  },
  description: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'Human-readable description of the transaction'
  },
  balance_before: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: 0.00,
    comment: 'Wallet balance immediately before this transaction was applied'
  },
  debit: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: 'Amount going out of the wallet'
  },
  credit: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: 'Amount coming into the wallet'
  },
  balance: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Running wallet balance after this transaction (balance_before + credit - debit)'
  },
  status: {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: 'completed',
    comment: 'Transaction status: completed, pending, failed, cancelled'
  },
  metadata: {
    type: Sequelize.TEXT,
    allowNull: true,
    comment: 'JSON string for additional transaction details'
  },
  createdAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  },
  updatedAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  }
}, {
  timestamps: true,
  tableName: 'Ledgers',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['transaction_type'] },
    { fields: ['transaction_id'] },
    { fields: ['createdAt'] },
    { fields: ['status'] },
    { fields: ['reference_table', 'reference_id'] }
  ]
});

/**
 * Sequelize associations.
 * The polymorphic link (reference_table / reference_id) is resolved dynamically
 * in the service layer rather than via Sequelize eager-loading, because a single
 * integer FK cannot be constrained to multiple tables simultaneously.
 */
Ledger.associate = function (models) {
  // Every ledger entry belongs to a wallet owner
  Ledger.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = Ledger;


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
    comment: 'Type of transaction: razorpay_charge, wallet_credit, wallet_debit, payout, transfer, etc.'
  },
  transaction_id: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'Reference to the original transaction (e.g., razorpay_transaction_id, wallet_transaction_id)'
  },
  reference_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'Reference to related table ID (e.g., wallet_transaction_id, merchant_transaction_charge_id)'
  },
  description: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'Human-readable description of the transaction'
  },
  debit: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: 'Debit amount (money going out)'
  },
  credit: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: 'Credit amount (money coming in)'
  },
  balance: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Running balance after this transaction'
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
    {
      fields: ['user_id']
    },
    {
      fields: ['transaction_type']
    },
    {
      fields: ['transaction_id']
    },
    {
      fields: ['createdAt']
    },
    {
      fields: ['status']
    }
  ]
});

module.exports = Ledger;


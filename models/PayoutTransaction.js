const Sequelize = require('sequelize');
const db = require('../config/database');

const PayoutTransaction = db.define('PayoutTransaction', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  merchant_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  beneficiary_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  reference_id: {
    type: Sequelize.STRING,
    allowNull: true
  },
  amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false
  },
  status: {
    type: Sequelize.STRING,
    allowNull: false
  },
  purpose: {
    type: Sequelize.STRING,
    allowNull: true
  },
  data: {
    type: Sequelize.TEXT,
    allowNull: true,
    comment: 'JSON stringified response data from BranchX API'
  },
  service_charge: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Service charge for the payout transaction'
  },
  payout_provider: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'Payout service provider: BranchX, Vimo, CredXPay, etc.'
  },
  callback_status: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'Latest status received in BranchX callback'
  },
  callback_data: {
    type: Sequelize.TEXT,
    allowNull: true,
    comment: 'Raw callback payload JSON from BranchX'
  },
  callback_received_at: {
    type: Sequelize.DATE,
    allowNull: true,
    comment: 'Timestamp when callback was processed'
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
  tableName: 'PayoutTransactions'
});

module.exports = PayoutTransaction;


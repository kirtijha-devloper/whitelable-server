const Sequelize = require('sequelize');
const db = require('../config/database');

const MerchantTransactionCharge = db.define('MerchantTransactionCharge', {
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
  pos_machine_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  razorpay_transaction_id: {
    type: Sequelize.STRING,
    allowNull: false,
    unique: true
  },
  transaction_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false
  },
  charge_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  net_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false
  },
  gst_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  gst_percent: {
    type: Sequelize.DECIMAL(5, 2),
    allowNull: true
  },
  charge_rate: {
    type: Sequelize.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  charge_config_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  payment_method: {
    type: Sequelize.STRING,
    allowNull: true
  },
  payment_card_type: {
    type: Sequelize.STRING,
    allowNull: true
  },
  payment_card_brand: {
    type: Sequelize.STRING,
    allowNull: true
  },
  wallet_transaction_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  rr_number: {
    type: Sequelize.STRING,
    allowNull: true
  },
  mid_number: {
    type: Sequelize.STRING,
    allowNull: true
  },
  tid_number: {
    type: Sequelize.STRING,
    allowNull: true
  },
  customer_name: {
    type: Sequelize.STRING,
    allowNull: true
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
  tableName: 'MerchantTransactionCharges'
});

module.exports = MerchantTransactionCharge;


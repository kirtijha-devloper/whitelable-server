const Sequelize = require('sequelize');
const db = require('../config/database');

const RazorpayNotification = db.define('RazorpayNotification', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.BIGINT
  },
  txn_id: {
    type: Sequelize.STRING(50),
    allowNull: false,
    unique: true,
    field: 'txn_id'
  },
  // additional columns extracted from event_json to support reporting
  mid: {
    type: Sequelize.STRING(100),
    allowNull: true,
    field: 'mid'
  },
  tid: {
    type: Sequelize.STRING(100),
    allowNull: true,
    field: 'tid'
  },
  amount: {
    type: Sequelize.BIGINT,
    allowNull: true,
    field: 'amount'
  },
  currency_code: {
    type: Sequelize.STRING(10),
    allowNull: true,
    field: 'currency_code'
  },
  payment_mode: {
    type: Sequelize.STRING(50),
    allowNull: true,
    field: 'payment_mode'
  },
  payment_card_type: {
    type: Sequelize.STRING(50),
    allowNull: true,
    field: 'payment_card_type'
  },
  payment_card_brand: {
    type: Sequelize.STRING(50),
    allowNull: true,
    field: 'payment_card_brand'
  },
  rr_number: {
    type: Sequelize.STRING(100),
    allowNull: true,
    field: 'rr_number'
  },
  device_serial: {
    type: Sequelize.STRING(100),
    allowNull: true,
    field: 'device_serial'
  },
  posting_date: {
    type: Sequelize.DATE,
    allowNull: true,
    field: 'posting_date'
  },
  event_json: {
    type: Sequelize.JSON,
    allowNull: false,
    field: 'event_json'
  },
  status: {
    type: Sequelize.STRING(30),
    allowNull: true,
    field: 'status'
  },
  createdAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    field: 'createdAt'
  },
  updatedAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    field: 'updatedAt'
  }
}, {
  tableName: 'razorpay_notifications',
  timestamps: true,
  underscored: false
});

module.exports = RazorpayNotification;
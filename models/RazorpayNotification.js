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
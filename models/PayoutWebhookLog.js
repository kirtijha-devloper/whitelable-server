const Sequelize = require('sequelize');
const db = require('../config/database');

const PayoutWebhookLog = db.define('PayoutWebhookLog', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  payload: {
    type: Sequelize.JSONB,
    allowNull: false
  },
  source_ip: {
    type: Sequelize.STRING(45)
  },
  processed: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  created_at: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('NOW()')
  }
}, {
  timestamps: false,
  tableName: 'payout_webhook_logs'
});

module.exports = PayoutWebhookLog;
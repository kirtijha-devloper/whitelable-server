const Sequelize = require('sequelize');
const db = require('../config/database');

const PayoutAuditLog = db.define('PayoutAuditLog', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  payout_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  action: {
    type: Sequelize.STRING(50),
    allowNull: false
  },
  details: {
    type: Sequelize.JSONB
  },
  created_at: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('NOW()')
  },
  updated_at: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('NOW()')
  }
}, {
  timestamps: false,
  tableName: 'payout_audit_logs'
});

module.exports = PayoutAuditLog;
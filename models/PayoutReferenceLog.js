const Sequelize = require('sequelize');
const db = require('../config/database');

const PayoutReferenceLog = db.define('PayoutReferenceLog', {
  id: {
    type: Sequelize.BIGINT,
    autoIncrement: true,
    primaryKey: true
  },
  reference: {
    type: Sequelize.STRING(30),
    allowNull: false
  },
  sequence_number: {
    type: Sequelize.BIGINT,
    allowNull: false
  },
  provider: {
    type: Sequelize.STRING(20),
    allowNull: true
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  created_at: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('NOW()')
  }
}, {
  timestamps: false,
  tableName: 'payout_reference_logs'
});

module.exports = PayoutReferenceLog;

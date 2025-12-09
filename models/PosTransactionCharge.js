const Sequelize = require('sequelize');
const db = require('../config/database');

const PosTransactionCharge = db.define('PosTransactionCharge', {
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
  method: {
    type: Sequelize.STRING,
    allowNull: true
  },
  network: {
    type: Sequelize.STRING,
    allowNull: true
  },
  card_type: {
    type: Sequelize.STRING,
    allowNull: true
  },
  subtype: {
    type: Sequelize.STRING,
    allowNull: true
  },
  rate_percentage: {
    type: Sequelize.DECIMAL(5, 2),
    allowNull: false
  },
  is_default: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false
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
  tableName: 'PosTransactionCharges'
});

module.exports = PosTransactionCharge;


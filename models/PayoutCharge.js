const Sequelize = require('sequelize');
const db = require('../config/database');

const PayoutCharge = db.define('PayoutCharge', {
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
  min: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true
  },
  max: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true
  },
  amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true
  },
  percentage: {
    type: Sequelize.DECIMAL(5, 2),
    allowNull: true
  },
  status: {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: 'active'
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
  tableName: 'PayoutCharges'
});

module.exports = PayoutCharge;


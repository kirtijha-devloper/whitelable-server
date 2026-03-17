const Sequelize = require('sequelize');
const db = require('../config/database');

const BbpsCcChargeRule = db.define('BbpsCcChargeRule', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  from_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
  },
  to_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
  },
  rate: {
    type: Sequelize.DECIMAL(10, 4),
    allowNull: false,
  },
  rate_type: {
    type: Sequelize.ENUM('percentage', 'flat'),
    allowNull: false,
    defaultValue: 'percentage',
  },
  is_active: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  description: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  createdAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
  },
  updatedAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
  },
});

module.exports = BbpsCcChargeRule;

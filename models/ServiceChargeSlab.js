const Sequelize = require('sequelize');
const db = require('../config/database');

const ServiceChargeSlab = db.define('ServiceChargeSlab', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  service_name: {
    type: Sequelize.STRING(50),
    allowNull: false,
    defaultValue: 'payout'
  },
  min_amount: {
    type: Sequelize.NUMERIC(14, 2),
    allowNull: false
  },
  max_amount: {
    type: Sequelize.NUMERIC(14, 2),
    allowNull: false
  },
  service_charge: {
    type: Sequelize.NUMERIC(10, 2),
    allowNull: false
  },
  created_at: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('NOW()')
  }
}, {
  timestamps: false,
  tableName: 'service_charge_slabs'
});

module.exports = ServiceChargeSlab;
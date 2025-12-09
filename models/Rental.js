const Sequelize = require('sequelize');
const db = require('../config/database');

const Rental = db.define('Rental', {
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
  franchaise_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false
  },
  status: {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: 'pending'
  },
  type: {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: 'pos'
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
  tableName: 'Rentals'
});

module.exports = Rental;


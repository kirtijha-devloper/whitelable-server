const Sequelize = require('sequelize');
const db = require('../config/database');

const BillAvenueBillFetch = db.define('BillAvenueBillFetch', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
  biller_id: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  customer_params: {
    type: Sequelize.JSONB,
    allowNull: true,
    comment: 'Input params sent for bill fetch (e.g. card number)',
  },
  amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true,
  },
  response: {
    type: Sequelize.JSONB,
    allowNull: true,
    comment: 'Full parsed BillAvenue response',
  },
  status: {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: 'pending',
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
}, {
  tableName: 'BillAvenueBillFetches',
});

module.exports = BillAvenueBillFetch;

const Sequelize = require('sequelize');
const db = require('../config/database');

const PgInventory = db.define('PgInventory', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  mid: {
    type: Sequelize.STRING(100),
    allowNull: false,
    unique: true,
  },
  gateway: {
    type: Sequelize.STRING(100),
    allowNull: false,
  },
  title: {
    type: Sequelize.STRING(150),
    allowNull: false,
  },
  company_name: {
    type: Sequelize.STRING(150),
    allowNull: false,
    defaultValue: 'Unallocated',
  },
  daily_limit: {
    type: Sequelize.STRING(100),
    allowNull: false,
    defaultValue: '₹ 50,00,000',
  },
  status: {
    type: Sequelize.STRING(50),
    allowNull: false,
    defaultValue: 'unallocated',
  },
}, {
  tableName: 'pg_inventory',
  timestamps: true,
});

module.exports = PgInventory;

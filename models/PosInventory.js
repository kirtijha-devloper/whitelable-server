const Sequelize = require('sequelize');
const db = require('../config/database');

const PosInventory = db.define('PosInventory', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  tid_number: {
    type: Sequelize.STRING(100),
    allowNull: false,
    unique: true,
  },
  serial_number: {
    type: Sequelize.STRING(100),
    allowNull: false,
    unique: true,
  },
  model: {
    type: Sequelize.STRING(100),
    allowNull: false,
    defaultValue: 'Pax A920',
  },
  company_name: {
    type: Sequelize.STRING(100),
    allowNull: false,
  },
  assigned_to: {
    type: Sequelize.STRING(150),
    allowNull: true,
    defaultValue: 'Unassigned',
  },
  assigned_user_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
  },
  status: {
    type: Sequelize.STRING(50),
    allowNull: false,
    defaultValue: 'available',
  },
}, {
  tableName: 'pos_inventory',
  timestamps: true,
});

module.exports = PosInventory;

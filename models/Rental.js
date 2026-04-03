const Sequelize = require('sequelize');
const db = require('../config/database');

const Rental = db.define('Rental', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  // null  → admin-defined rate
  // non-null → franchise-defined rate (value = franchise user ID)
  franchaise_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  // Who this rate is charged to:
  //   'franchise' – admin charges franchises at this rate
  //   'merchant'  – admin charges standalone merchants, OR franchise charges their merchants
  target_user_type: {
    type: Sequelize.STRING(50),
    allowNull: false
  },
  // who created this rate record
  created_by: {
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
    defaultValue: 'active'
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


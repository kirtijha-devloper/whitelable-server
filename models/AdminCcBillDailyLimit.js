const Sequelize = require('sequelize');
const db = require('../config/database');

const AdminCcBillDailyLimit = db.define('AdminCcBillDailyLimit', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true,
    allowNull: false,
  },
  admin_id: {
    type: Sequelize.INTEGER,
    allowNull: false,
  },
  company_id: {
    type: Sequelize.STRING(255),
    allowNull: true,
  },
  business_date: {
    type: Sequelize.STRING(10),
    allowNull: false,
  },
  daily_limit: {
    type: Sequelize.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  consumed_amount: {
    type: Sequelize.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  reserved_amount: {
    type: Sequelize.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  createdAt: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.NOW,
  },
  updatedAt: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.NOW,
  },
}, {
  tableName: 'admin_cc_bill_daily_limits',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['admin_id', 'business_date'],
      name: 'admin_cc_bill_daily_limits_admin_date_unique',
    },
    {
      fields: ['company_id'],
      name: 'admin_cc_bill_daily_limits_company_id_idx',
    },
  ],
});

module.exports = AdminCcBillDailyLimit;


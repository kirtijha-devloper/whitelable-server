const Sequelize = require('sequelize');
const db = require('../config/database');

const CcBillLimitReservation = db.define('CcBillLimitReservation', {
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
  business_date: {
    type: Sequelize.STRING(10),
    allowNull: false,
  },
  flow: {
    type: Sequelize.STRING(50),
    allowNull: false,
  },
  reference_id: {
    type: Sequelize.STRING(150),
    allowNull: false,
  },
  amount: {
    type: Sequelize.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  status: {
    type: Sequelize.STRING(30),
    allowNull: false,
    defaultValue: 'RESERVED',
  },
  metadata: {
    type: Sequelize.JSON,
    allowNull: true,
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
  tableName: 'cc_bill_limit_reservations',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['flow', 'reference_id'],
      name: 'cc_bill_limit_reservations_flow_ref_unique',
    },
    {
      fields: ['admin_id', 'business_date'],
      name: 'cc_bill_limit_reservations_admin_date_idx',
    },
  ],
});

module.exports = CcBillLimitReservation;


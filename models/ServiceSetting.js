const Sequelize = require('sequelize');
const db = require('../config/database');

const SERVICE_SETTING_ALLOWED_KEYS = [
  'vimo_payout',
  'branchx_payout',
  'sevenpay_payout',
  'ndia5_payout',
  'cc_bill_pay',
  'ba_cc_bill_pay',
  'cc_bill_3',
  'mx_payout',
  'pos_t0_settlement',
  'user_daily_limit',
  'pos_inventory',
  'aadhaar_pay',
  'qr_payments',
];

const ServiceSetting = db.define('ServiceSetting', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  service_key: {
    type: Sequelize.STRING(100),
    allowNull: false,
    unique: true,
  },
  label: {
    type: Sequelize.STRING(150),
    allowNull: true,
  },
  category: {
    type: Sequelize.STRING(100),
    allowNull: true,
    defaultValue: 'General',
  },
  description: {
    type: Sequelize.TEXT,
    allowNull: true,
  },
  is_enabled: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  target_roles: {
    type: Sequelize.JSON,
    allowNull: true,
  },
  updated_by: {
    type: Sequelize.INTEGER,
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
}, {
  tableName: 'service_settings',
  timestamps: true,
});

module.exports = ServiceSetting;

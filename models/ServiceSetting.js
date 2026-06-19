const Sequelize = require('sequelize');
const db = require('../config/database');

const SERVICE_SETTING_ALLOWED_KEYS = [
  'vimo_payout',
  'branchx_payout',
  'sevenpay_payout',
  'cc_bill_pay',
  'ba_cc_bill_pay',
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
    validate: {
      isIn: {
        args: [SERVICE_SETTING_ALLOWED_KEYS],
        msg: `service_key must be one of: ${SERVICE_SETTING_ALLOWED_KEYS.join(', ')}`,
      },
    },
  },
  is_enabled: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
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

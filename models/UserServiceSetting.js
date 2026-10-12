const Sequelize = require('sequelize');
const db = require('../config/database');

const USER_SERVICE_ALLOWED_KEYS = [
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
  'pos',
  'pg',
  'qr',
  'soundbox',
  'dmt',
  'billpayments',
];

const UserServiceSetting = db.define('UserServiceSetting', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: false,
  },
  company_id: {
    type: Sequelize.STRING,
    allowNull: true,
    references: {
      model: 'Companies',
      key: 'company_id',
    },
    comment: 'Company / white-label tenant identifier',
  },
  service_key: {
    type: Sequelize.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: {
        msg: 'service_key cannot be empty',
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
  updated_at: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
  },
}, {
  tableName: 'user_service_settings',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'service_key'],
    },
    {
      fields: ['company_id'],
    },
  ],
});

module.exports = UserServiceSetting;
module.exports.USER_SERVICE_ALLOWED_KEYS = USER_SERVICE_ALLOWED_KEYS;

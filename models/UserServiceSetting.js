const Sequelize = require('sequelize');
const db = require('../config/database');

const USER_SERVICE_ALLOWED_KEYS = [
  'vimo_payout',
  'branchx_payout',
  'cc_bill_pay',
  'ba_cc_bill_pay',
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
  service_key: {
    type: Sequelize.STRING(100),
    allowNull: false,
    validate: {
      isIn: {
        args: [USER_SERVICE_ALLOWED_KEYS],
        msg: `service_key must be one of: ${USER_SERVICE_ALLOWED_KEYS.join(', ')}`,
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
      fields: ['user_id'],
    },
    {
      fields: ['service_key'],
    },
  ],
});

module.exports = UserServiceSetting;

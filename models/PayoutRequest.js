const Sequelize = require('sequelize');
const db = require('../config/database');

const PayoutRequest = db.define('PayoutRequest', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  request_id: {
    type: Sequelize.STRING(50),
    allowNull: false,
    unique: true
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  company_id: {
    type: Sequelize.STRING,
    allowNull: true,
    references: {
      model: 'Companies',
      key: 'company_id'
    },
    comment: 'Company / white-label tenant identifier'
  },
  amount: {
    type: Sequelize.NUMERIC(14, 2),
    allowNull: false
  },
  charge: {
    type: Sequelize.NUMERIC(14, 2),
    allowNull: false,
    defaultValue: 0
  },
  mobile_number: {
    type: Sequelize.STRING(15)
  },
  account_number: {
    type: Sequelize.STRING(50),
    allowNull: false
  },
  ifsc_code: {
    type: Sequelize.STRING(20),
    allowNull: false
  },
  beneficiary_name: {
    type: Sequelize.STRING(255)
  },
  bank_name: {
    type: Sequelize.STRING(255)
  },
  transfer_mode: {
    type: Sequelize.STRING(10),
    allowNull: false,
    defaultValue: 'IMPS'
  },
  opening_balance: {
    type: Sequelize.NUMERIC(14, 2)
  },
  closing_balance: {
    type: Sequelize.NUMERIC(14, 2)
  },
  response_status: {
    type: Sequelize.STRING(20),
    allowNull: false,
    defaultValue: 'PROCESSING'
  },
  response_message: {
    type: Sequelize.TEXT
  },
  response_status_code: {
    type: Sequelize.STRING(50)
  },
  utr: {
    type: Sequelize.STRING(100)
  },
  api_txn_id: {
    type: Sequelize.STRING(100)
  },
  op_ref_id: {
    type: Sequelize.STRING(100)
  },
  response: {
    type: Sequelize.JSONB
  },
  service_provider: {
    type: Sequelize.STRING(50),
    allowNull: false,
    defaultValue: 'CredXPay'
  },
  refunded: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  latitude: {
    type: Sequelize.STRING(30)
  },
  longitude: {
    type: Sequelize.STRING(30)
  },
  email_id: {
    type: Sequelize.STRING(255)
  },
  purpose: {
    type: Sequelize.STRING(255)
  },
  created_at: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('NOW()')
  },
  updated_at: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('NOW()')
  }
}, {
  timestamps: false,
  tableName: 'payout_requests'
});

PayoutRequest.associate = function(models) {
  PayoutRequest.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
  PayoutRequest.belongsTo(models.Company, {
    foreignKey: 'company_id',
    targetKey: 'company_id',
    as: 'company'
  });
};

module.exports = PayoutRequest;
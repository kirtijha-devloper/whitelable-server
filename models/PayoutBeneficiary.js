const Sequelize = require('sequelize');
const db = require('../config/database');

const PayoutBeneficiary = db.define('PayoutBeneficiary', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  name: {
    type: Sequelize.STRING(255),
    allowNull: false
  },
  account_number: {
    type: Sequelize.STRING(50),
    allowNull: false
  },
  ifsc_code: {
    type: Sequelize.STRING(20),
    allowNull: false
  },
  bank_name: {
    type: Sequelize.STRING(255),
    allowNull: false
  },
  branch_name: {
    type: Sequelize.STRING(255)
  },
  state: {
    type: Sequelize.STRING(255)
  },
  mobile: {
    type: Sequelize.STRING(15)
  },
  email: {
    type: Sequelize.STRING(255)
  },
  is_verified: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false
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
  tableName: 'payout_beneficiaries'
});

module.exports = PayoutBeneficiary;
const Sequelize = require('sequelize');
const db = require('../config/database');

const Beneficiary = db.define('Beneficiary', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
     user_id: {
        type: Sequelize.INTEGER,
        allowNull: false
    },
    remitter_id: {type: Sequelize.INTEGER,
        allowNull: false},
  mobile: {
    type: Sequelize.STRING,
    allowNull: false
  },
  bank_name: {
    type: Sequelize.STRING,
    allowNull: false
  },
  bank_account_number: {
    type: Sequelize.STRING,
    allowNull: false
  },
  bank_account_holder_name: {
    type: Sequelize.STRING,
    allowNull: false
  },
  bank_ifsc: {
    type: Sequelize.STRING,
    allowNull: false
  },
  beneficiary_mobile: {
    type: Sequelize.STRING,
    allowNull: false
  },
  status: {
    type: Sequelize.INTEGER,
    defaultValue: 1
  },
  external_reference_id: {
    type: Sequelize.STRING,
    allowNull: true
  }
}, {
  timestamps: true
});

module.exports = Beneficiary;

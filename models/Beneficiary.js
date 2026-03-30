const Sequelize = require('sequelize');
const db = require('../config/database');

const Beneficiary = db.define(
  'Beneficiary',
  {
    id: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    merchant_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },
    mobile_number: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    bank_name: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    account_number: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    beneficiary_name: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    ifsc_code: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    email: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: '',
    },
    status: {
      type: Sequelize.ENUM('active', 'inactive', 'verified'),
      allowNull: false,
      defaultValue: 'active',
    },
    // branch_name: optional; populated for Vimo beneficiaries.
    // Was stored as bank_branch_name before migration 20260505000001.
    branch_name: {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    },
    // state: required by Vimo at the application level; nullable for BranchX beneficiaries.
    state: {
      type: Sequelize.STRING(255),
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = Beneficiary;

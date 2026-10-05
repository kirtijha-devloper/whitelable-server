const Sequelize = require('sequelize');
const db = require('../config/database');

const Company = db.define('Company', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },

  company_id: {
    allowNull: false,
    unique: true,
    type: Sequelize.STRING
  },

  company_name: {
    allowNull: false,
    type: Sequelize.STRING
  },

  director_name: {
    allowNull: true,
    type: Sequelize.STRING
  },

  email: {
    allowNull: true,
    type: Sequelize.STRING
  },

  mobile_number: {
    allowNull: true,
    type: Sequelize.STRING
  },

  address1: {
    allowNull: true,
    type: Sequelize.STRING
  },

  address2: {
    allowNull: true,
    type: Sequelize.STRING
  },

  city: {
    allowNull: true,
    type: Sequelize.STRING
  },

  district: {
    allowNull: true,
    type: Sequelize.STRING
  },

  state: {
    allowNull: true,
    type: Sequelize.STRING
  },

  country: {
    allowNull: true,
    type: Sequelize.STRING
  },

  pincode: {
    allowNull: true,
    type: Sequelize.STRING
  },

  pan_number: {
    allowNull: true,
    type: Sequelize.STRING
  },

  gst_number: {
    allowNull: true,
    type: Sequelize.STRING
  },

  admin_list: {
    allowNull: true,
    type: Sequelize.JSONB,
    defaultValue: []
  },

  payout_limit: {
    allowNull: false,
    type: Sequelize.DECIMAL(15, 2),
    defaultValue: 0
  },

  bill_payment_limit: {
    allowNull: false,
    type: Sequelize.DECIMAL(15, 2),
    defaultValue: 0
  },

  status: {
    allowNull: false,
    type: Sequelize.STRING,
    defaultValue: 'active'
  },

  createdAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW
  },

  updatedAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW
  }
}, {
  tableName: 'Companies',
  timestamps: true
});

Company.associate = function(models) {
  Company.hasMany(models.User, {
    foreignKey: 'company_id',
    sourceKey: 'company_id',
    as: 'users'
  });
};

module.exports = Company;

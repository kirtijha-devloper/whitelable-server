const Sequelize = require('sequelize');
const db = require('../config/database');

const CcBillPayment = db.define('CcBillPayment', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
  biller_id: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  param1: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  param2: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  transaction_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
  },
  customer_mobile: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  payment_mode: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  payment_info: {
    type: Sequelize.JSONB,
    allowNull: true,
  },
  enquiry_reference_id: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  external_ref: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  statuscode: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  status: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  response: {
    type: Sequelize.JSONB,
    allowNull: true,
  },
  charge_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true,
  },
  geo_code: {
    type: Sequelize.STRING,
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
});

CcBillPayment.associate = function(models) {
  CcBillPayment.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user',
  });
};

module.exports = CcBillPayment;

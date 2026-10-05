const Sequelize = require('sequelize');
const db = require('../config/database');

const BillAvenuePayment = db.define('BillAvenuePayment', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
  company_id: {
    type: Sequelize.STRING,
    allowNull: true,
    references: {
      model: 'Companies',
      key: 'company_id',
    },
  },
  biller_id: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  customer_params: {
    type: Sequelize.JSONB,
    allowNull: true,
    comment: 'Input params sent for payment (e.g. card number)',
  },
  transaction_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
  },
  payment_mode: {
    type: Sequelize.STRING,
    allowNull: true,
    defaultValue: 'Cash',
  },
  transaction_ref_id: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'BillAvenue transaction reference ID from response',
  },
  status: {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: 'pending',
  },
  response_code: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  response: {
    type: Sequelize.JSONB,
    allowNull: true,
    comment: 'Full parsed BillAvenue response',
  },
  charge_amount: {
    type: Sequelize.DECIMAL(10, 2),
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
  tableName: 'BillAvenuePayments',
});

BillAvenuePayment.associate = (models) => {
  if (models.User) {
    BillAvenuePayment.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  }
  if (models.Company) {
    BillAvenuePayment.belongsTo(models.Company, { foreignKey: 'company_id', targetKey: 'company_id', as: 'company' });
  }
};

module.exports = BillAvenuePayment;

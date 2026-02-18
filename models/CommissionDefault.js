const Sequelize = require('sequelize');
const db = require('../config/database');

const CommissionDefault = db.define('CommissionDefault', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  payment_card_brand: {
    type: Sequelize.STRING,
    allowNull: true
  },
  payment_card_type: {
    type: Sequelize.STRING,
    allowNull: true
  },
  payment_mode: {
    type: Sequelize.STRING,
    allowNull: true
  },
  min_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: null
  },
  max_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: null
  },
  flat_fee: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: 0.00
  },
  percent_fee: {
    type: Sequelize.DECIMAL(5, 2),
    allowNull: true,
    defaultValue: 0.00
  },
  is_active: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  created_by: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  createdAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  },
  updatedAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  }
}, {
  timestamps: true,
  tableName: 'CommissionDefaults'
});

CommissionDefault.associate = function(models) {
  if (models.UserCommission) {
    CommissionDefault.hasMany(models.UserCommission, { foreignKey: 'commission_default_id', as: 'userCommissions' });
  }
};

module.exports = CommissionDefault;

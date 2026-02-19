const Sequelize = require('sequelize');
const db = require('../config/database');

const UserCommission = db.define('UserCommission', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  commission_default_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  // user-specific optional overrides; NULL means "no override — use CommissionDefault"
  flat_fee: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: null
  },
  percent_fee: {
    type: Sequelize.DECIMAL(5, 2),
    allowNull: true,
    defaultValue: null
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
  tableName: 'UserCommissions'
});

UserCommission.associate = function(models) {
  if (models.User) {
    UserCommission.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  }
  if (models.CommissionDefault) {
    UserCommission.belongsTo(models.CommissionDefault, { foreignKey: 'commission_default_id', as: 'defaultCommission' });
  }
};

module.exports = UserCommission;

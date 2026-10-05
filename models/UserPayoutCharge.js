const Sequelize = require('sequelize');
const db = require('../config/database');

// Per-user slab-based payout charge override rules.
// Mirrors PayoutCharge model exactly — adds user_id as the differentiator.
const UserPayoutCharge = db.define('UserPayoutCharge', {
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
  company_id: {
    type: Sequelize.STRING,
    allowNull: true,
    references: {
      model: 'Companies',
      key: 'company_id',
    },
    comment: 'Company / white-label tenant identifier',
  },
  from_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
  },
  to_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
  },
  rate: {
    type: Sequelize.DECIMAL(10, 4),
    allowNull: false,
  },
  rate_type: {
    type: Sequelize.ENUM('percentage', 'flat'),
    allowNull: false,
    defaultValue: 'percentage',
  },
  is_active: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  description: {
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
}, {
  timestamps: true,
  tableName: 'UserPayoutCharges',
});

UserPayoutCharge.associate = function(models) {
  UserPayoutCharge.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user',
  });
  UserPayoutCharge.belongsTo(models.Company, {
    foreignKey: 'company_id',
    targetKey: 'company_id',
    as: 'company',
  });
};

module.exports = UserPayoutCharge;

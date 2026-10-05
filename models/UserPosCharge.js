const Sequelize = require('sequelize');
const db = require('../config/database');

// User-specific POS charge overrides.
// Links a user (merchant) to a PosChargeDefault entry.
// flat_fee / percent_fee here, if set (non-null), override the default values.
const UserPosCharge = db.define('UserPosCharge', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: false,
    comment: 'The merchant this override applies to'
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
  pos_charge_default_id: {
    type: Sequelize.INTEGER,
    allowNull: false,
    comment: 'Reference to PosChargeDefaults'
  },
  // NULL means "no override — use value from PosChargeDefault"
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
  tableName: 'UserPosCharges'
});

UserPosCharge.associate = function (models) {
  if (models.User) {
    UserPosCharge.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  }
  if (models.PosChargeDefault) {
    UserPosCharge.belongsTo(models.PosChargeDefault, {
      foreignKey: 'pos_charge_default_id',
      as: 'defaultPosCharge'
    });
  }
};

module.exports = UserPosCharge;

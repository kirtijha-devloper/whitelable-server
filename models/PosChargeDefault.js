const Sequelize = require('sequelize');
const db = require('../config/database');

// Default POS charge rates keyed on the combination of
// payment_mode, payment_card_type, payment_card_brand.
// Any field may be NULL to act as a wildcard.
const PosChargeDefault = db.define('PosChargeDefault', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  payment_mode: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'e.g. credit, debit, prepaid, upi — NULL = any mode'
  },
  payment_card_type: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'e.g. credit, debit — NULL = any type'
  },
  payment_card_brand: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'e.g. VISA, MASTERCARD, RUPAY — NULL = any brand'
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
  tableName: 'PosChargeDefaults'
});

PosChargeDefault.associate = function (models) {
  if (models.UserPosCharge) {
    PosChargeDefault.hasMany(models.UserPosCharge, {
      foreignKey: 'pos_charge_default_id',
      as: 'userPosCharges'
    });
  }
};

module.exports = PosChargeDefault;

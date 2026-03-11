const Sequelize = require('sequelize');
const db = require('../config/database');

const PosChargeRule = db.define('PosChargeRule', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'merchant-specific rule; null means global'
  },
  franchaise_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'franchise-specific rule; null for none'
  },
  created_by: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'user id who created this record (used for permissions/filtering)'
  },
  scope: {
    type: Sequelize.STRING(30),
    allowNull: false,
    defaultValue: 'admin_default',
    comment: 'Rule tier: admin_default | admin_franchise | admin_merchant | franchise_default | franchise_merchant'
  },
  payment_mode: {
    type: Sequelize.STRING,
    allowNull: false
  },
  card_type: {
    type: Sequelize.STRING,
    allowNull: true
  },
  card_brand: {
    type: Sequelize.STRING,
    allowNull: true
  },
  card_classification: {
    type: Sequelize.STRING,
    allowNull: true
  },
  settlement_type: {
    type: Sequelize.STRING,
    allowNull: true
  },
  min_amount: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0
  },
  max_amount: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: true
  },
  charge_percent: {
    type: Sequelize.DECIMAL(5, 2),
    allowNull: false
  },
  charge_flat: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: true,
    defaultValue: 0
  },
  gst_required: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  gst_percent: {
    type: Sequelize.DECIMAL(5, 2),
    allowNull: true,
    defaultValue: 0
  },
  is_active: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true
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
  tableName: 'pos_charge_rules'
});

module.exports = PosChargeRule;

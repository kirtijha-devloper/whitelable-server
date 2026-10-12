const Sequelize = require('sequelize');
const db = require('../config/database');

const ServiceChargeRule = db.define(
  'ServiceChargeRule',
  {
    id: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    service_key: {
      type: Sequelize.STRING(100),
      allowNull: false,
    },
    service_name: {
      type: Sequelize.STRING(150),
      allowNull: false,
    },
    category: {
      type: Sequelize.STRING(100),
      allowNull: false,
    },
    min_amount: {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
    },
    max_amount: {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
    },
    fee_type: {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'flat',
    },
    flat_fee: {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.0,
    },
    percent_fee: {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0.0,
    },
    gst_percent: {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 18.0,
    },
    is_gst_inclusive: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    target_role: {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'all',
    },
    payment_mode: {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'ALL',
    },
    is_active: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    created_by: {
      type: Sequelize.INTEGER,
      allowNull: true,
    },
    created_at: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    },
  },
  {
    tableName: 'service_charge_rules',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

ServiceChargeRule.associate = function (models) {
  if (models.User) {
    ServiceChargeRule.belongsTo(models.User, {
      foreignKey: 'created_by',
      as: 'creator',
    });
  }
};

module.exports = ServiceChargeRule;

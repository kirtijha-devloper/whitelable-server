const Sequelize = require('sequelize');
const db = require('../config/database');

const Commission = db.define(
  'Commission',
  {
    id: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    transaction_id: {
      type: Sequelize.STRING(100),
      allowNull: false,
    },
    utr_no: {
      type: Sequelize.STRING(100),
      allowNull: true,
    },
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },
    user_role: {
      type: Sequelize.STRING(50),
      allowNull: false,
    },
    service_key: {
      type: Sequelize.STRING(100),
      allowNull: false,
    },
    payment_mode: {
      type: Sequelize.STRING(50),
      allowNull: true,
    },
    txn_amount: {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
    },
    applied_rate: {
      type: Sequelize.STRING(50),
      allowNull: false,
    },
    commission_amount: {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
    },
    platform_margin: {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
    },
    status: {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'CREDITED',
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
    tableName: 'commissions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

Commission.associate = function (models) {
  if (models.User) {
    Commission.belongsTo(models.User, {
      foreignKey: 'user_id',
      as: 'user',
    });
  }
};

module.exports = Commission;

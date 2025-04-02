const Sequelize = require('sequelize');
const db = require('../config/database');

const ChargeSlab = db.define('ChargeSlab', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  charge_type_category: {
    type: Sequelize.STRING,
    allowNull: false
  },
  charge_type_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: true // optional: per-user-specific slabs
  },
  created_by: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  min_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true
  },
  max_amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true
  },
  flat_fee: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: true
  },
  percent_fee: {
    type: Sequelize.DECIMAL(5, 2),
    allowNull: true
  },
  createdAt: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  },
  updatedAt: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  }
});

ChargeSlab.associate = function (models) {
  ChargeSlab.belongsTo(models.ChargeType, {
    foreignKey: 'charge_type_id',
    as: 'chargeType'
  });
};

module.exports = ChargeSlab;

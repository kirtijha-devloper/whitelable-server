const Sequelize = require('sequelize');
const db = require('../config/database');

const ChargeType = db.define('ChargeType', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  name: {
    type: Sequelize.STRING,
    allowNull: false
  },
  category: {
    type: Sequelize.STRING,
    allowNull: false
  },
  created_by: {
    type: Sequelize.INTEGER,
    allowNull: false
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

ChargeType.associate = function (models) {
  ChargeType.hasMany(models.ChargeSlab, {
    foreignKey: 'charge_type_id',
    as: 'slabs'
  });
};

module.exports = ChargeType;

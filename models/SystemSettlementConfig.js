const Sequelize = require('sequelize');
const db = require('../config/database');

const SystemSettlementConfig = db.define('SystemSettlementConfig', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  global_cutoff_enabled: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  global_default_cutoff_time: {
    type: Sequelize.STRING(5),
    allowNull: false,
    defaultValue: '10:00',
  },
  auto_settlement_time: {
    type: Sequelize.STRING(5),
    allowNull: false,
    defaultValue: '10:00',
  },
  createdAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW,
  },
  updatedAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW,
  },
}, {
  tableName: 'system_settlement_configs',
  timestamps: true,
});

module.exports = SystemSettlementConfig;

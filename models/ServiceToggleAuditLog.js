const Sequelize = require('sequelize');
const db = require('../config/database');

const ServiceToggleAuditLog = db.define('ServiceToggleAuditLog', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: false,
    comment: 'ID of the Admin or Employee performing the toggle',
  },
  affected_user_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'ID of the target merchant or franchise user (NULL for global settings)',
  },
  service_key: {
    type: Sequelize.STRING(100),
    allowNull: false,
  },
  previous_state: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
  },
  new_state: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
  },
  action: {
    type: Sequelize.STRING(50),
    allowNull: false,
    comment: 'ENABLE, DISABLE, CREDIT, or DEBIT',
  },
  balance_before: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: true,
  },
  balance_after: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: true,
  },
  ip_address: {
    type: Sequelize.STRING(100),
    allowNull: true,
  },
  user_agent: {
    type: Sequelize.STRING(500),
    allowNull: true,
  },
}, {
  tableName: 'ServiceToggleAuditLogs',
  timestamps: true,
  indexes: [
    {
      fields: ['user_id'],
    },
    {
      fields: ['affected_user_id'],
    },
    {
      fields: ['service_key'],
    },
    {
      fields: ['createdAt'],
    },
  ],
});

ServiceToggleAuditLog.associate = (models) => {
  if (models.User) {
    ServiceToggleAuditLog.belongsTo(models.User, { foreignKey: 'user_id', as: 'performingUser' });
    ServiceToggleAuditLog.belongsTo(models.User, { foreignKey: 'affected_user_id', as: 'affectedUser' });
  }
};

module.exports = ServiceToggleAuditLog;

const Sequelize = require('sequelize');
const db = require('../config/database');

const SettlementAuditLog = db.define('SettlementAuditLog', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  performing_user_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'NULL for system auto-settlements',
  },
  affected_user_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'NULL for global system-wide changes',
  },
  action: {
    type: Sequelize.STRING(50),
    allowNull: false,
  },
  previous_state: {
    type: Sequelize.TEXT,
    allowNull: true,
  },
  new_state: {
    type: Sequelize.TEXT,
    allowNull: true,
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
  tableName: 'settlement_audit_logs',
  timestamps: true,
});

SettlementAuditLog.associate = (models) => {
  if (models.User) {
    SettlementAuditLog.belongsTo(models.User, { as: 'performingUser', foreignKey: 'performing_user_id' });
    SettlementAuditLog.belongsTo(models.User, { as: 'affectedUser', foreignKey: 'affected_user_id' });
  }
};

module.exports = SettlementAuditLog;

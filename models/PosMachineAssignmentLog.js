const Sequelize = require('sequelize');
const db = require('../config/database');

const PosMachineAssignmentLog = db.define('PosMachineAssignmentLog', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  pos_machine_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  action: {
    type: Sequelize.STRING(50),
    allowNull: false
  },
  assigned_from_user_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  assigned_to_user_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  performed_by_user_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  details: {
    type: Sequelize.JSONB,
    allowNull: true
  },
  created_at: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('NOW()')
  },
  updated_at: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('NOW()')
  }
}, {
  timestamps: false,
  tableName: 'pos_machine_assignment_logs'
});

module.exports = PosMachineAssignmentLog;

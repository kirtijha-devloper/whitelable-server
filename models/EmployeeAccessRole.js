const Sequelize = require('sequelize');
const db = require('../config/database');

const EmployeeAccessRole = db.define('EmployeeAccessRole', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  name: {
    allowNull: false,
    type: Sequelize.STRING,
    unique: true,
  },
  slug: {
    allowNull: false,
    type: Sequelize.STRING,
    unique: true,
  },
  description: {
    allowNull: true,
    type: Sequelize.TEXT,
  },
  permissions: {
    allowNull: false,
    type: Sequelize.JSON,
    defaultValue: [],
    comment: 'Action-based permissions granted to employees assigned to this access role.',
  },
  status: {
    allowNull: false,
    type: Sequelize.STRING,
    defaultValue: 'active',
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
  tableName: 'EmployeeAccessRoles',
  timestamps: true,
});

module.exports = EmployeeAccessRole;

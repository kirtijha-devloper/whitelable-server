const Sequelize = require('sequelize');
const db = require('../config/database');

const LoginPopup = db.define('LoginPopup', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  title: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  image_path: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  display_order: {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  is_active: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  starts_at: {
    type: Sequelize.DATE,
    allowNull: true,
  },
  ends_at: {
    type: Sequelize.DATE,
    allowNull: true,
  },
  target_roles: {
    type: Sequelize.JSON,
    allowNull: true,
    defaultValue: null,
  },
  created_at: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW,
  },
  updated_at: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW,
  },
}, {
  tableName: 'login_popups',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = LoginPopup;

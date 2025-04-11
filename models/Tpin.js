const Sequelize = require('sequelize');
const db = require('../config/database');

const Tpin = db.define('Tpin', {
  id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: Sequelize.INTEGER, allowNull: false },
  tpin: { type: Sequelize.STRING, allowNull: false },
  expires_at: { type: Sequelize.DATE, allowNull: false },
}, {
  timestamps: true,
});

module.exports = Tpin;

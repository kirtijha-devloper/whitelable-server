const Sequelize = require('sequelize');
const db = require('../config/database');

const RefSequence = db.define('RefSequence', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  service: {
    type: Sequelize.STRING(50),
    allowNull: false,
    unique: true
  },
  current_number: {
    type: Sequelize.BIGINT,
    allowNull: false,
    defaultValue: 1
  },
  updated_at: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('NOW()')
  }
}, {
  timestamps: false,
  tableName: 'ref_sequences'
});

module.exports = RefSequence;
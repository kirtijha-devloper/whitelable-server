const Sequelize = require('sequelize');
const db = require('../config/database');

// Simple table to keep track of the last sequence used for each username prefix.
// Prefixes are things like 'APM' (merchant), 'APF' (franchaise), 'APA' (admin).
// A row is created lazily when the first username for that prefix is generated.

const UsernameSequence = db.define('UsernameSequence', {
  prefix: {
    type: Sequelize.STRING,
    primaryKey: true
  },
  current_value: {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'username_sequences',
  timestamps: false
});

module.exports = UsernameSequence;

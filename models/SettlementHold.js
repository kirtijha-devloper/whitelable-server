const Sequelize = require('sequelize');
const db = require('../config/database');

const SettlementHold = db.define('SettlementHold', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: false,
    comment: 'User whose POS earnings are held'
  },
  ledger_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'FK to the Ledgers credit entry that generated this hold'
  },
  amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Net amount held (transaction amount minus charge)'
  },
  hold_date: {
    type: Sequelize.DATEONLY,
    allowNull: false,
    comment: 'Date on which the POS transaction occurred'
  },
  release_at: {
    type: Sequelize.DATE,
    allowNull: false,
    comment: 'Timestamp when the hold is released (next day 10:30 AM IST)'
  },
  released: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Whether this hold has been released and funds are spendable'
  },
  createdAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  },
  updatedAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  }
}, {
  timestamps: true,
  tableName: 'SettlementHolds',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['released'] },
    { fields: ['release_at'] },
    { fields: ['user_id', 'released'] }
  ]
});

SettlementHold.associate = function (models) {
  SettlementHold.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user',
    constraints: false
  });
  SettlementHold.belongsTo(models.Ledger, {
    foreignKey: 'ledger_id',
    as: 'ledger',
    constraints: false
  });
};

module.exports = SettlementHold;

const Sequelize = require('sequelize');
const db = require('../config/database');

const WalletTransaction = db.define('WalletTransaction', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  type: {
    type: Sequelize.STRING,
    allowNull: false
  },
  amount: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false
  },
  status: {
    type: Sequelize.STRING,
    defaultValue: 'pending'
  },
  reason: {
    type: Sequelize.STRING
  },
  requested_by: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  approved_by: {
    type: Sequelize.INTEGER,
    allowNull: true
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
});

// WalletTransaction.associate = function(models) {
//   WalletTransaction.belongsTo(models.User, {
//     foreignKey: 'user_id',
//     as: 'requester'
//   });

//   WalletTransaction.belongsTo(models.User, {
//     foreignKey: 'user_id',
//     as: 'approver'
//   });
// };

module.exports = WalletTransaction;

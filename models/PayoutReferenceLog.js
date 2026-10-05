const Sequelize = require('sequelize');
const db = require('../config/database');

const PayoutReferenceLog = db.define('PayoutReferenceLog', {
  id: {
    type: Sequelize.BIGINT,
    autoIncrement: true,
    primaryKey: true
  },
  reference: {
    type: Sequelize.STRING(30),
    allowNull: false
  },
  sequence_number: {
    type: Sequelize.BIGINT,
    allowNull: false
  },
  provider: {
    type: Sequelize.STRING(20),
    allowNull: true
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  company_id: {
    type: Sequelize.STRING,
    allowNull: true,
    references: {
      model: 'Companies',
      key: 'company_id'
    },
    comment: 'Company / white-label tenant identifier'
  },
  created_at: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('NOW()')
  }
}, {
  timestamps: false,
  tableName: 'payout_reference_logs'
});

PayoutReferenceLog.associate = function(models) {
  PayoutReferenceLog.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
  PayoutReferenceLog.belongsTo(models.Company, {
    foreignKey: 'company_id',
    targetKey: 'company_id',
    as: 'company'
  });
};

module.exports = PayoutReferenceLog;

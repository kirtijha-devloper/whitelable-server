const Sequelize = require('sequelize');
const db = require('../config/database');

/**
 * PosGlobalRate — single-row table that holds the universal fallback POS charge rate.
 * Applied by the razorpayWebhookWorker when no user-specific or combination-based
 * default rate matches the transaction.
 *
 * Only one active record is expected (id = 1, maintained via upsert).
 */
const PosGlobalRate = db.define('PosGlobalRate', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  percent_fee: {
    type: Sequelize.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: 'Fallback percentage fee applied when no specific combination matches'
  },
  is_active: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  updated_by: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'ID of the admin who last set/updated this rate'
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
  tableName: 'PosGlobalRates'
});

module.exports = PosGlobalRate;

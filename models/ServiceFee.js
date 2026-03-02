const Sequelize = require('sequelize');
const db = require('../config/database');

/**
 * ServiceFee — stores flat or percentage fees associated with named services
 * (activation, verification, etc.).  Only administrators may create/update
 * these records; other roles may read the list so that the UI can display the
 * current charges to merchants.
 */

const ServiceFee = db.define('ServiceFee', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  service_name: {
    type: Sequelize.STRING(100),
    allowNull: false,
    unique: true,
    comment: 'Unique identifier for the service (e.g. "activation", "bank_verification")'
  },
  flat_fee: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: 'Fixed fee amount in currency units'
  },
  percent_fee: {
    type: Sequelize.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: 'Percentage fee (0.00–100.00); if both flat and percent are nonzero, percent takes precedence in calculations'
  },
  is_active: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  created_by: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'Admin user ID who created this fee'
  },
  updated_by: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'Admin user ID who last updated this fee'
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
  tableName: 'service_fees',
  timestamps: true
});

module.exports = ServiceFee;
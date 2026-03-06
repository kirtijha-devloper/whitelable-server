const Sequelize = require('sequelize');
const db = require('../config/database');

/**
 * CompanyName — simple lookup table used by administrators to maintain a list
 * of valid company names.  Other tables (eg. posMachine.company_name) may
 * reference values from this list if needed.
 */

const CompanyName = db.define('CompanyName', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  name: {
    type: Sequelize.STRING(255),
    allowNull: false,
    unique: true,
    comment: 'The company name itself'
  },
  created_by: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'Admin user ID who created the record'
  },
  updated_by: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'Admin user ID who last updated the record'
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
  tableName: 'company_names',
  timestamps: true
});

module.exports = CompanyName;

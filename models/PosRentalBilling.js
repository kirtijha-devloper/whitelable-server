const Sequelize = require('sequelize');
const db = require('../config/database');

/**
 * PosRentalBilling tracks the 30-day billing cycle for each POS machine
 * assignment. A new record is created every time a machine is assigned to a
 * user; the record is set to 'inactive' when the machine is unassigned.
 *
 * Columns:
 *   pos_machine_id    – FK to PosMachines
 *   assigned_to       – User ID the machine is currently assigned to
 *   assigned_to_role  – 'merchant' | 'franchaise'
 *   franchise_id      – If assigned user is a merchant under a franchise, the
 *                       franchise's user ID (null otherwise)
 *   rental_start_date – Date the machine was assigned (billing cycle start)
 *   next_charge_date  – Date the next rental deduction should run
 *                       (rental_start_date + 30 days, then +30 each cycle)
 *   last_charged_at   – Timestamp of the most recent successful charge
 *   status            – 'active' | 'inactive'
 */
const PosRentalBilling = db.define('PosRentalBilling', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  pos_machine_id: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  assigned_to: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  assigned_to_role: {
    type: Sequelize.STRING(50),
    allowNull: false
  },
  // Set when the assigned user is a merchant who belongs to a franchise
  franchise_id: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  rental_start_date: {
    type: Sequelize.DATEONLY,
    allowNull: false
  },
  next_charge_date: {
    type: Sequelize.DATEONLY,
    allowNull: false
  },
  last_charged_at: {
    type: Sequelize.DATE,
    allowNull: true
  },
  status: {
    type: Sequelize.STRING(50),
    allowNull: false,
    defaultValue: 'active'
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
  tableName: 'PosRentalBillings'
});

module.exports = PosRentalBilling;

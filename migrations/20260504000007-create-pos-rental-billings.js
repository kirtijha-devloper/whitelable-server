'use strict';

/**
 * Create PosRentalBillings table.
 *
 * Each row tracks the 30-day rental billing cycle for one POS machine
 * assignment. A new row is created when a machine is assigned to any user,
 * and set to 'inactive' when the machine is unassigned or deactivated.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PosRentalBillings', {
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
      // User ID the machine is currently assigned to (merchant or franchise)
      assigned_to: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      // 'merchant' or 'franchaise'
      assigned_to_role: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      // Populated when the assigned user is a merchant under a franchise
      franchise_id: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      // Calendar date when the current billing cycle started (assignment date)
      rental_start_date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      // Calendar date when the next deduction should run (start + 30 days, then +30 per cycle)
      next_charge_date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      // Timestamp of the last successful rental deduction
      last_charged_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      // 'active' | 'inactive'
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
    });

    // Index on pos_machine_id + status for fast cron lookups
    await queryInterface.addIndex('PosRentalBillings', ['pos_machine_id', 'status'], {
      name: 'pos_rental_billings_pos_machine_status_idx'
    });

    // Index on next_charge_date + status for efficient cron queries
    await queryInterface.addIndex('PosRentalBillings', ['next_charge_date', 'status'], {
      name: 'pos_rental_billings_next_charge_status_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('PosRentalBillings');
  }
};

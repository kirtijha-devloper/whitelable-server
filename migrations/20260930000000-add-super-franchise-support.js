'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Add super_franchise_id to Users table
    const usersTable = await queryInterface.describeTable('Users');
    if (!usersTable.super_franchise_id) {
      await queryInterface.addColumn('Users', 'super_franchise_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Parent Super Franchise user ID (if applicable)'
      });
    }

    // 2. Add super_franchise_id to pos_charge_rules table
    const posChargeRulesTable = await queryInterface.describeTable('pos_charge_rules');
    if (!posChargeRulesTable.super_franchise_id) {
      await queryInterface.addColumn('pos_charge_rules', 'super_franchise_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Super franchise specific charge rule target'
      });
    }

    // 3. Add super_franchise_id to PosMachines table
    let posMachinesTableName = 'PosMachines';
    let posMachinesTable;
    try {
      posMachinesTable = await queryInterface.describeTable('PosMachines');
    } catch (_e) {
      posMachinesTableName = 'pos_machines';
      posMachinesTable = await queryInterface.describeTable('pos_machines');
    }

    if (posMachinesTable && !posMachinesTable.super_franchise_id) {
      await queryInterface.addColumn(posMachinesTableName, 'super_franchise_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Assigned Super Franchise user ID for POS Machine'
      });
    }

    // 4. Add super_franchise_id to Rentals table
    const rentalsTable = await queryInterface.describeTable('Rentals');
    if (!rentalsTable.super_franchise_id) {
      await queryInterface.addColumn('Rentals', 'super_franchise_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Super Franchise user ID associated with rental rate definition'
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const usersTable = await queryInterface.describeTable('Users');
    if (usersTable.super_franchise_id) {
      await queryInterface.removeColumn('Users', 'super_franchise_id');
    }

    const posChargeRulesTable = await queryInterface.describeTable('pos_charge_rules');
    if (posChargeRulesTable.super_franchise_id) {
      await queryInterface.removeColumn('pos_charge_rules', 'super_franchise_id');
    }

    const posMachinesTable = await queryInterface.describeTable('pos_machines');
    if (posMachinesTable.super_franchise_id) {
      await queryInterface.removeColumn('pos_machines', 'super_franchise_id');
    }

    const rentalsTable = await queryInterface.describeTable('Rentals');
    if (rentalsTable.super_franchise_id) {
      await queryInterface.removeColumn('Rentals', 'super_franchise_id');
    }
  }
};

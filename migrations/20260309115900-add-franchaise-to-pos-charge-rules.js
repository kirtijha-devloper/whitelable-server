'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('pos_charge_rules', 'franchaise_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'franchise-specific rule; null means global or merchant specific'
    });

    // index may help lookups
    await queryInterface.addIndex('pos_charge_rules', ['franchaise_id']);
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeIndex('pos_charge_rules', ['franchaise_id']);
    await queryInterface.removeColumn('pos_charge_rules', 'franchaise_id');
  }
};

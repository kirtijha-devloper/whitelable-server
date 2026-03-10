'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // add created_by column so we can distinguish rules created by
    // the franchise itself from those seeded by admin/global defaults.
    await queryInterface.addColumn('pos_charge_rules', 'created_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'user id who created this rule'
    });

    // index helps queries that filter on creator
    await queryInterface.addIndex('pos_charge_rules', ['created_by'], {
      name: 'idx_pos_charge_rules_created_by'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('pos_charge_rules', 'idx_pos_charge_rules_created_by');
    await queryInterface.removeColumn('pos_charge_rules', 'created_by');
  }
};

'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('pg_charge_rules');
    if (!tableInfo.sub_type) {
      await queryInterface.addColumn('pg_charge_rules', 'sub_type', {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const tableInfo = await queryInterface.describeTable('pg_charge_rules');
    if (tableInfo.sub_type) {
      await queryInterface.removeColumn('pg_charge_rules', 'sub_type');
    }
  },
};

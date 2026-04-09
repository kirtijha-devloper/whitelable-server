'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Beneficiaries');
    if (!table.branch_name) {
      return;
    }

    await queryInterface.changeColumn('Beneficiaries', 'branch_name', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Beneficiaries');
    if (!table.branch_name) {
      return;
    }

    await queryInterface.sequelize.query(`
      UPDATE "Beneficiaries"
      SET "branch_name" = 'N/A'
      WHERE "branch_name" IS NULL
    `);

    await queryInterface.changeColumn('Beneficiaries', 'branch_name', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'N/A',
    });
  },
};

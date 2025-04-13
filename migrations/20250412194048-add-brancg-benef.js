'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Beneficiaries', 'bank_branch_name', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'N/A',
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Beneficiaries', 'bank_branch_name');
  }
};

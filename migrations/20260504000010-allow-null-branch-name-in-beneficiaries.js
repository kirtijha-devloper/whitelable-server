'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Beneficiaries', 'branch_name', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Beneficiaries', 'branch_name', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: '',
    });
  },
};

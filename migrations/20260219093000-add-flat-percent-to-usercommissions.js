'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('UserCommissions', 'flat_fee', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null
    });
    await queryInterface.addColumn('UserCommissions', 'percent_fee', {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface /* , Sequelize */) {
    await queryInterface.removeColumn('UserCommissions', 'flat_fee');
    await queryInterface.removeColumn('UserCommissions', 'percent_fee');
  }
};
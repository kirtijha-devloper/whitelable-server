'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('UserCommissions');

    if (!cols.flat_fee) {
      await queryInterface.addColumn('UserCommissions', 'flat_fee', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: null
      });
    }

    if (!cols.percent_fee) {
      await queryInterface.addColumn('UserCommissions', 'percent_fee', {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        defaultValue: null
      });
    }
  },

  async down(queryInterface) {
    const cols = await queryInterface.describeTable('UserCommissions');
    if (cols.flat_fee)   await queryInterface.removeColumn('UserCommissions', 'flat_fee');
    if (cols.percent_fee) await queryInterface.removeColumn('UserCommissions', 'percent_fee');
  }
};
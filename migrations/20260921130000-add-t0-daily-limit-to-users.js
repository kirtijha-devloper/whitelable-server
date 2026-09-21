'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('Users');
    if (!tableInfo.t0_daily_limit) {
      await queryInterface.addColumn('Users', 't0_daily_limit', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
        defaultValue: null,
        comment: 'Daily T0 settlement limit (in INR). Null means unassigned.'
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('Users');
    if (tableInfo.t0_daily_limit) {
      await queryInterface.removeColumn('Users', 't0_daily_limit');
    }
  }
};

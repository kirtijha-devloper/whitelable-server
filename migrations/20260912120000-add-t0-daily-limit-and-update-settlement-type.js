'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableDescription = await queryInterface.describeTable('users');

    if (!tableDescription.t0_daily_limit) {
      await queryInterface.addColumn('users', 't0_daily_limit', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
        defaultValue: null,
        comment: 'Daily limit for T0 settlements. NULL means Unlimited.',
      });
    }

    if (tableDescription.settlement_type) {
      await queryInterface.changeColumn('users', 'settlement_type', {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'T0',
      });
    } else {
      await queryInterface.addColumn('users', 'settlement_type', {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'T0',
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableDescription = await queryInterface.describeTable('users');
    if (tableDescription.t0_daily_limit) {
      await queryInterface.removeColumn('users', 't0_daily_limit');
    }
  }
};

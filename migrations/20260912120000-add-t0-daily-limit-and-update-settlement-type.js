'use strict';

async function describeUserTable(queryInterface) {
  try {
    const desc = await queryInterface.describeTable('Users');
    return { name: 'Users', desc };
  } catch (_) {
    const desc = await queryInterface.describeTable('users');
    return { name: 'users', desc };
  }
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { name: tableName, desc: tableDescription } = await describeUserTable(queryInterface);

    if (!tableDescription.t0_daily_limit) {
      await queryInterface.addColumn(tableName, 't0_daily_limit', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
        defaultValue: null,
        comment: 'Daily limit for T0 settlements. NULL means Unlimited.',
      });
    }

    if (tableDescription.settlement_type) {
      await queryInterface.changeColumn(tableName, 'settlement_type', {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'T0',
      });
    } else {
      await queryInterface.addColumn(tableName, 'settlement_type', {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'T0',
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const { name: tableName, desc: tableDescription } = await describeUserTable(queryInterface);
    if (tableDescription.t0_daily_limit) {
      await queryInterface.removeColumn(tableName, 't0_daily_limit');
    }
  }
};

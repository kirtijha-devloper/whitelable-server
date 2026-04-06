'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Users');

    if (!table.wallet_hold) {
      await queryInterface.addColumn('Users', 'wallet_hold', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('Users');

    if (table.wallet_hold) {
      await queryInterface.removeColumn('Users', 'wallet_hold');
    }
  },
};

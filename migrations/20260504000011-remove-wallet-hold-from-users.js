'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Users', 'wallet_hold');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'wallet_hold', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
    });
  }
};

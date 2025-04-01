'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'settlement_type', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'today_settlement',
    });

     await queryInterface.addColumn('Users', 'wallet_hold', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Users', 'settlement_type');
    await queryInterface.removeColumn('Users', 'wallet_hold');
  }
};

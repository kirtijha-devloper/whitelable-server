'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('PayoutTransactions', 'service_charge', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Service charge for the payout transaction'
    });
  },

  async down (queryInterface, Sequelize) {

    await queryInterface.removeColumn('PayoutTransactions', 'service_charge');
  }
};

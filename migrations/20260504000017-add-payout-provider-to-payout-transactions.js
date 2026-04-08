"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('PayoutTransactions', 'payout_provider', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Payout service provider identifier (e.g. BranchX, Vimo, CredXPay)'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('PayoutTransactions', 'payout_provider');
  }
};

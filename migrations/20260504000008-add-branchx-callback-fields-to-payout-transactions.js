'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('PayoutTransactions', 'callback_status', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Latest status received in BranchX callback'
    });

    await queryInterface.addColumn('PayoutTransactions', 'callback_data', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Raw callback payload JSON from BranchX'
    });

    await queryInterface.addColumn('PayoutTransactions', 'callback_received_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Timestamp when callback was processed'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('PayoutTransactions', 'callback_received_at');
    await queryInterface.removeColumn('PayoutTransactions', 'callback_data');
    await queryInterface.removeColumn('PayoutTransactions', 'callback_status');
  }
};
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Check if column exists before adding (idempotent migration)
    const tableDescription = await queryInterface.describeTable('PayoutTransactions');
    
    if (!tableDescription.data) {
      await queryInterface.addColumn('PayoutTransactions', 'data', {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON stringified response data from BranchX API'
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // Check if column exists before removing
    const tableDescription = await queryInterface.describeTable('PayoutTransactions');
    
    if (tableDescription.data) {
      await queryInterface.removeColumn('PayoutTransactions', 'data');
    }
  }
};


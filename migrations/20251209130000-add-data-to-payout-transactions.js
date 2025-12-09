'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('PayoutTransactions', 'data', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'JSON stringified response data from BranchX API'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('PayoutTransactions', 'data');
  }
};


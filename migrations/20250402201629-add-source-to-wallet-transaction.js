'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('WalletTransactions', 'source', {
      type: Sequelize.STRING,
      allowNull: true // or false if required
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('WalletTransactions', 'source');
  }
};

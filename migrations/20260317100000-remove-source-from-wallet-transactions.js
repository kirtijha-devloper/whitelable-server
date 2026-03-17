'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('WalletTransactions').catch(() => null);
    if (tableDesc && tableDesc.source) {
      await queryInterface.removeColumn('WalletTransactions', 'source');
    }
  },

  async down(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('WalletTransactions').catch(() => null);
    if (tableDesc && !tableDesc.source) {
      await queryInterface.addColumn('WalletTransactions', 'source', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },
};

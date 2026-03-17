'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('WalletTransactions');
    if (!tableDesc.source) {
      await queryInterface.addColumn('WalletTransactions', 'source', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const tableDesc = await queryInterface.describeTable('WalletTransactions');
    if (tableDesc.source) {
      await queryInterface.removeColumn('WalletTransactions', 'source');
    }
  },
};

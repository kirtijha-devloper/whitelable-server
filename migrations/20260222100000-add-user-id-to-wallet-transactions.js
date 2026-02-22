'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDescription = await queryInterface.describeTable('WalletTransactions');
    if (!tableDescription.user_id) {
      await queryInterface.addColumn('WalletTransactions', 'user_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const tableDescription = await queryInterface.describeTable('WalletTransactions');
    if (tableDescription.user_id) {
      await queryInterface.removeColumn('WalletTransactions', 'user_id');
    }
  }
};

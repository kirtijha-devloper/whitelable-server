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
    if (!tableDescription.company_id) {
      await queryInterface.addColumn('WalletTransactions', 'company_id', {
        type: Sequelize.STRING,
        allowNull: true,
        references: {
          model: 'Companies',
          key: 'company_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Company / white-label tenant identifier'
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const tableDescription = await queryInterface.describeTable('WalletTransactions');
    if (tableDescription.company_id) {
      await queryInterface.removeColumn('WalletTransactions', 'company_id');
    }
    if (tableDescription.user_id) {
      await queryInterface.removeColumn('WalletTransactions', 'user_id');
    }
  }
};

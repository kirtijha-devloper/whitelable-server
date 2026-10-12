'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('Transactions');

    if (!tableInfo.user_id) {
      await queryInterface.addColumn('Transactions', 'user_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }

    if (!tableInfo.service) {
      await queryInterface.addColumn('Transactions', 'service', {
        type: Sequelize.STRING(100),
        allowNull: true,
        defaultValue: 'POS',
      });
    }

    if (!tableInfo.charge) {
      await queryInterface.addColumn('Transactions', 'charge', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0.00,
      });
    }

    if (!tableInfo.utr_no) {
      await queryInterface.addColumn('Transactions', 'utr_no', {
        type: Sequelize.STRING(100),
        allowNull: true,
      });
    }

    if (!tableInfo.transaction_id) {
      await queryInterface.addColumn('Transactions', 'transaction_id', {
        type: Sequelize.STRING(100),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const tableInfo = await queryInterface.describeTable('Transactions');
    if (tableInfo.transaction_id) await queryInterface.removeColumn('Transactions', 'transaction_id');
    if (tableInfo.utr_no) await queryInterface.removeColumn('Transactions', 'utr_no');
    if (tableInfo.charge) await queryInterface.removeColumn('Transactions', 'charge');
    if (tableInfo.service) await queryInterface.removeColumn('Transactions', 'service');
    if (tableInfo.user_id) await queryInterface.removeColumn('Transactions', 'user_id');
  },
};

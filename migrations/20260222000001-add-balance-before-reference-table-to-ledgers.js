'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add balance_before: wallet balance at the moment BEFORE this transaction was applied
    await queryInterface.addColumn('Ledgers', 'balance_before', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,          // nullable for backward-compat with existing rows
      defaultValue: 0.00,
      comment: 'Wallet balance immediately before this transaction was applied'
    });

    // Add reference_table: identifies which table reference_id belongs to
    await queryInterface.addColumn('Ledgers', 'reference_table', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Table name that reference_id points to: WalletTransactions | MerchantTransactionCharges | PayoutTransactions | Rentals'
    });

    // Composite index for fast linked-record lookups
    await queryInterface.addIndex('Ledgers', ['reference_table', 'reference_id'], {
      name: 'idx_ledgers_reference_table_id'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('Ledgers', 'idx_ledgers_reference_table_id');
    await queryInterface.removeColumn('Ledgers', 'reference_table');
    await queryInterface.removeColumn('Ledgers', 'balance_before');
  }
};

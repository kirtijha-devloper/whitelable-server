'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Ledgers');

    if (!table.status) {
      await queryInterface.addColumn('Ledgers', 'status', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'completed',
      });

      await queryInterface.addIndex('Ledgers', ['status'], {
        name: 'idx_ledgers_status',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('Ledgers');

    if (table.status) {
      try {
        await queryInterface.removeIndex('Ledgers', 'idx_ledgers_status');
      } catch (_error) {
        // Ignore if the index does not exist.
      }

      await queryInterface.removeColumn('Ledgers', 'status');
    }
  },
};

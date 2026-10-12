'use strict';

const TABLE_NAMES = ['Tpins', 'Ledgers'];

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const tableName of TABLE_NAMES) {
      const columns = await queryInterface.describeTable(tableName);
      if (columns.company_id) {
        continue;
      }

      await queryInterface.addColumn(tableName, 'company_id', {
        allowNull: true,
        type: Sequelize.STRING,
        references: {
          model: 'Companies',
          key: 'company_id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Company / white-label tenant identifier',
      });
    }
  },

  async down(queryInterface) {
    for (const tableName of [...TABLE_NAMES].reverse()) {
      const columns = await queryInterface.describeTable(tableName);
      if (columns.company_id) {
        await queryInterface.removeColumn(tableName, 'company_id');
      }
    }
  },
};
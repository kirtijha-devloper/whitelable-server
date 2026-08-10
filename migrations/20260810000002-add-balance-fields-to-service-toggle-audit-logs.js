'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('ServiceToggleAuditLogs');
    if (!tableInfo.balance_before) {
      await queryInterface.addColumn('ServiceToggleAuditLogs', 'balance_before', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      });
    }
    if (!tableInfo.balance_after) {
      await queryInterface.addColumn('ServiceToggleAuditLogs', 'balance_after', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const tableInfo = await queryInterface.describeTable('ServiceToggleAuditLogs');
    if (tableInfo.balance_before) {
      await queryInterface.removeColumn('ServiceToggleAuditLogs', 'balance_before');
    }
    if (tableInfo.balance_after) {
      await queryInterface.removeColumn('ServiceToggleAuditLogs', 'balance_after');
    }
  },
};

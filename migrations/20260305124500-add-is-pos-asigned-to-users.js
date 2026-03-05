'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = 'Users';
    const desc = await queryInterface.describeTable(table);
    if (!desc.is_pos_asigned) {
      await queryInterface.addColumn(table, 'is_pos_asigned', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    // safe to attempt removal even if column doesn't exist
    await queryInterface.removeColumn('Users', 'is_pos_asigned').catch(() => {});
  }
};

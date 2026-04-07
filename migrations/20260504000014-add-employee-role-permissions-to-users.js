'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Users');

    if (!table.permissions) {
      await queryInterface.addColumn('Users', 'permissions', {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
        comment: 'Action-based permissions for employee users.',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('Users');

    if (table.permissions) {
      await queryInterface.removeColumn('Users', 'permissions');
    }
  },
};

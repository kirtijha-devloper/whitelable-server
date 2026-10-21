'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const usersTable = await queryInterface.describeTable('Users');
    if (!usersTable.admin_id) {
      await queryInterface.addColumn('Users', 'admin_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Parent Admin user ID to whom this user/hierarchy belongs'
      });
      await queryInterface.addIndex('Users', ['admin_id'], {
        name: 'users_admin_id_idx'
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const usersTable = await queryInterface.describeTable('Users');
    if (usersTable.admin_id) {
      await queryInterface.removeColumn('Users', 'admin_id');
    }
  }
};

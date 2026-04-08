'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('login_popups', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      title: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      image_path: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      display_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      starts_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      ends_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      target_roles: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: null,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('login_popups', ['is_active'], {
      name: 'login_popups_is_active_idx',
    });

    await queryInterface.addIndex('login_popups', ['display_order'], {
      name: 'login_popups_display_order_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('login_popups');
  },
};

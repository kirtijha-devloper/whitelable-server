'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('service_settings');

    if (!tableInfo.label) {
      await queryInterface.addColumn('service_settings', 'label', {
        type: Sequelize.STRING(150),
        allowNull: true,
      });
    }

    if (!tableInfo.category) {
      await queryInterface.addColumn('service_settings', 'category', {
        type: Sequelize.STRING(100),
        allowNull: true,
        defaultValue: 'General',
      });
    }

    if (!tableInfo.description) {
      await queryInterface.addColumn('service_settings', 'description', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    if (!tableInfo.target_roles) {
      await queryInterface.addColumn('service_settings', 'target_roles', {
        type: Sequelize.JSON,
        allowNull: true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('service_settings', 'target_roles');
    await queryInterface.removeColumn('service_settings', 'description');
    await queryInterface.removeColumn('service_settings', 'category');
    await queryInterface.removeColumn('service_settings', 'label');
  }
};

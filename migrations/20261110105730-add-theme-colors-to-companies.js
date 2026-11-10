'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('Companies');
    if (!tableInfo.theme_colors) {
      await queryInterface.addColumn('Companies', 'theme_colors', {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface) {
    const tableInfo = await queryInterface.describeTable('Companies');
    if (tableInfo.theme_colors) {
      await queryInterface.removeColumn('Companies', 'theme_colors');
    }
  },
};
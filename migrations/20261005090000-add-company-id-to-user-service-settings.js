'use strict';

const TABLE_NAME = 'user_service_settings';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable(TABLE_NAME);
    if (columns.company_id) {
      return;
    }

    await queryInterface.addColumn(TABLE_NAME, 'company_id', {
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
  },

  async down(queryInterface) {
    const columns = await queryInterface.describeTable(TABLE_NAME);
    if (columns.company_id) {
      await queryInterface.removeColumn(TABLE_NAME, 'company_id');
    }
  },
};

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'company_id', {
      allowNull: true,
      type: Sequelize.STRING,

      references: {
        model: 'Companies',
        key: 'company_id',
      },

      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Users', 'company_id');
  },
};
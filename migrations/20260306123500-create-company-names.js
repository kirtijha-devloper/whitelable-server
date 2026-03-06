'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('CompanyNames', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
        comment: 'Name of the company (managed by admin)'
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Admin user ID who created this record'
      },
      updated_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Admin user ID who last updated this record'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('CompanyNames');
  }
};

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pg_inventory', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      mid: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      gateway: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      title: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      company_name: {
        type: Sequelize.STRING(150),
        allowNull: false,
        defaultValue: 'Unallocated',
      },
      daily_limit: {
        type: Sequelize.STRING(100),
        allowNull: false,
        defaultValue: '₹ 50,00,000',
      },
      status: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'unallocated',
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('pg_inventory');
  }
};

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('UserCommissions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      company_id: {
        type: Sequelize.STRING,
        allowNull: true,
        references: {
          model: 'Companies',
          key: 'company_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Company / white-label tenant identifier'
      },
      commission_default_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'CommissionDefaults', key: 'id' },
        onDelete: 'CASCADE'
      },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: { type: Sequelize.INTEGER, allowNull: true },
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

    await queryInterface.addIndex('UserCommissions', ['user_id']);
    await queryInterface.addIndex('UserCommissions', ['commission_default_id']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('UserCommissions');
  }
};

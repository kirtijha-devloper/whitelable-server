'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ChargeSlabs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      user_id:  { type: Sequelize.INTEGER },
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
      charge_type_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'ChargeTypes',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      min_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      max_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      flat_fee: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      percent_fee: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true
      },
      created_by: { type: Sequelize.INTEGER },
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
    await queryInterface.dropTable('ChargeSlabs');
  }
};

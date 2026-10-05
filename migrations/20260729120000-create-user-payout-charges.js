'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('UserPayoutCharges', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      company_id: {
        type: Sequelize.STRING,
        allowNull: true,
        references: {
          model: 'Companies',
          key: 'company_id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Company / white-label tenant identifier',
      },
      from_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      to_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      rate: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: false,
      },
      rate_type: {
        type: Sequelize.ENUM('percentage', 'flat'),
        allowNull: false,
        defaultValue: 'percentage',
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      description: {
        type: Sequelize.STRING,
        allowNull: true,
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

  async down(queryInterface) {
    await queryInterface.dropTable('UserPayoutCharges');
  },
};

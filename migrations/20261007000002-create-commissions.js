'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('commissions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      transaction_id: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      utr_no: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      user_role: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      service_key: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      payment_mode: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      txn_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
      },
      applied_rate: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      commission_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      platform_margin: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'CREDITED',
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

    await queryInterface.addIndex('commissions', ['user_id', 'created_at'], {
      name: 'idx_user_date',
    });
    await queryInterface.addIndex('commissions', ['service_key'], {
      name: 'idx_service',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('commissions');
  },
};

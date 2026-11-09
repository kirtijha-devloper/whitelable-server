'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pg_transactions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      company_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      gateway: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      order_id: {
        type: Sequelize.STRING(150),
        allowNull: false,
        unique: true,
      },
      payment_id: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
      },
      fee_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      gst_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      net_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      status: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'pending',
      },
      payment_url: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      return_url: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      payment_mode: {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: 'CARD',
      },
      card_network: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      card_type: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      card_sub_type: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      webhook_payload: {
        type: Sequelize.JSON,
        allowNull: true,
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

    await queryInterface.addIndex('pg_transactions', ['user_id']);
    await queryInterface.addIndex('pg_transactions', ['order_id'], { unique: true });
    await queryInterface.addIndex('pg_transactions', ['payment_id']);
    await queryInterface.addIndex('pg_transactions', ['gateway']);
    await queryInterface.addIndex('pg_transactions', ['status']);
    await queryInterface.addIndex('pg_transactions', ['created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pg_transactions');
  },
};

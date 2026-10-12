'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('service_charge_rules', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      service_key: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      service_name: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      category: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      min_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      max_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      fee_type: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'flat',
      },
      flat_fee: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      percent_fee: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      gst_percent: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 18.00,
      },
      is_gst_inclusive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      target_role: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'all',
      },
      payment_mode: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'ALL',
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_by: {
        type: Sequelize.INTEGER,
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

    await queryInterface.addIndex('service_charge_rules', ['service_key'], {
      name: 'idx_service_key',
    });
    await queryInterface.addIndex('service_charge_rules', ['target_role'], {
      name: 'idx_target_role',
    });
    await queryInterface.addIndex('service_charge_rules', ['min_amount', 'max_amount'], {
      name: 'idx_amounts',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('service_charge_rules');
  },
};

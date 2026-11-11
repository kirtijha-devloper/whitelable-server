'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pg_charge_rules', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Merchant-specific rule or admin-specific super_admin_admin rule'
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
      },
      franchaise_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Franchise-specific rule'
      },
      super_franchise_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Super-franchise-specific rule'
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'User id who created this record'
      },
      scope: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'admin_default',
        comment: 'Rule tier: super_admin_default | super_admin_admin | admin_default | admin_super_franchise | super_franchise_franchise | super_franchise_default | super_franchise_merchant | admin_franchise | admin_merchant | franchise_default | franchise_merchant'
      },
      gateway: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'ALL',
        comment: 'ALL | pg1 | pg2'
      },
      payment_mode: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'ALL',
        comment: 'ALL | UPI | CARD | CREDIT_CARD | DEBIT_CARD | NET_BANKING | WALLET'
      },
      card_type: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      card_brand: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      card_classification: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      sub_type: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      settlement_type: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      channel: {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: 'WEB',
      },
      min_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      max_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      },
      charge_percent: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      charge_flat: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      gst_required: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      gst_percent: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        defaultValue: 0.00,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('pg_charge_rules', ['user_id']);
    await queryInterface.addIndex('pg_charge_rules', ['franchaise_id']);
    await queryInterface.addIndex('pg_charge_rules', ['super_franchise_id']);
    await queryInterface.addIndex('pg_charge_rules', ['company_id']);
    await queryInterface.addIndex('pg_charge_rules', ['scope']);
    await queryInterface.addIndex('pg_charge_rules', ['gateway']);
    await queryInterface.addIndex('pg_charge_rules', ['payment_mode']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pg_charge_rules');
  },
};

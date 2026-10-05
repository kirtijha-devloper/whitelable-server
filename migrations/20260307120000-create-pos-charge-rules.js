'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pos_charge_rules', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Merchant ID; NULL means global rule'
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
      payment_mode: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'CARD, UPI, etc'
      },
      card_type: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'CREDIT, DEBIT'
      },
      card_brand: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'VISA, MASTERCARD, RUPAY'
      },
      card_classification: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'CLASSIC, PLATINUM, BUSINESS, etc'
      },
      settlement_type: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'TODAY, NEXT_DAY, etc'
      },
      min_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        comment: 'Lower bound of transaction amount slab'
      },
      max_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Upper bound of the slab; NULL means open-ended'
      },
      charge_percent: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        comment: 'MDR percentage value (0 - 100)'
      },
      charge_flat: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
        defaultValue: 0,
        comment: 'Optional flat charge amount'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
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

    // add index for quick lookup
    await queryInterface.addIndex('pos_charge_rules', [
      'user_id',
      'payment_mode',
      'card_type',
      'card_brand',
      'card_classification',
      'settlement_type'
    ], {
      name: 'idx_charge_lookup'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('pos_charge_rules', 'idx_charge_lookup');
    await queryInterface.dropTable('pos_charge_rules');
  }
};
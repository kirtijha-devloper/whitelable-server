'use strict';

/**
 * Replaces the per-merchant PayoutCharges schema with a global slab-based
 * rule table that mirrors the BbpsCcChargeRules pattern:
 *   from_amount / to_amount / rate / rate_type / is_active / description
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Drop the old per-merchant table entirely and recreate with the new schema.
    await queryInterface.dropTable('PayoutCharges');

    await queryInterface.createTable('PayoutCharges', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
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

    await queryInterface.addIndex('PayoutCharges', ['from_amount', 'to_amount'], {
      name: 'idx_payout_charge_range',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('PayoutCharges');

    // Restore original schema
    await queryInterface.createTable('PayoutCharges', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      merchant_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      min: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      max: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      percentage: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      is_default: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },
};

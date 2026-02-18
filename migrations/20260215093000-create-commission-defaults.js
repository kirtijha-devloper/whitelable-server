'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('CommissionDefaults', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      payment_card_brand: { type: Sequelize.STRING },
      payment_card_type: { type: Sequelize.STRING },
      payment_mode: { type: Sequelize.STRING },
      min_amount: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      max_amount: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      flat_fee: { type: Sequelize.DECIMAL(10, 2), allowNull: true, defaultValue: 0.00 },
      percent_fee: { type: Sequelize.DECIMAL(5, 2), allowNull: true, defaultValue: 0.00 },
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

    // DB-level check to enforce only-one-of(flat_fee, percent_fee) (COALESCE for NULL safety)
    await queryInterface.sequelize.query(`
      ALTER TABLE "CommissionDefaults"
      ADD CONSTRAINT commission_fee_xor CHECK (COALESCE(flat_fee,0) = 0 OR COALESCE(percent_fee,0) = 0)
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('CommissionDefaults');
  }
};

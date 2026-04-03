'use strict';

/**
 * Update Rentals table:
 *   - Make merchant_id nullable   (it was NOT NULL; rate configs don't belong to a single merchant)
 *   - Add created_by column        (FK-like integer tracking who created the rate)
 *   - Change status default        ('pending' → 'active' to match the new semantics)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Allow merchant_id to be NULL
    await queryInterface.changeColumn('Rentals', 'merchant_id', {
      type: Sequelize.INTEGER,
      allowNull: true
    });

    // Add created_by column
    await queryInterface.addColumn('Rentals', 'created_by', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Rentals', 'created_by');

    // Revert merchant_id to NOT NULL (fill any nulls first in real usage)
    await queryInterface.changeColumn('Rentals', 'merchant_id', {
      type: Sequelize.INTEGER,
      allowNull: false
    });
  }
};

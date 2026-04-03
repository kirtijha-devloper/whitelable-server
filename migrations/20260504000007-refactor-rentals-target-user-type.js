'use strict';

/**
 * Refactor Rentals table:
 *   - Add   target_user_type  ('franchise' | 'merchant')
 *   - Drop  merchant_id       (was always null after previous migration)
 *   - Drop  is_default        (replaced by franchaise_id IS NULL + target_user_type)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Rentals', 'target_user_type', {
      type: Sequelize.STRING(50),
      allowNull: true   // temporarily allow null so existing rows don't fail
    });

    // Back-fill existing rows: admin rows (franchaise_id IS NULL) → 'franchise'
    // (best-effort; rows created before this migration used is_default semantics)
    await queryInterface.sequelize.query(`
      UPDATE "Rentals"
      SET target_user_type = CASE
        WHEN franchaise_id IS NULL THEN 'franchise'
        ELSE 'merchant'
      END
      WHERE target_user_type IS NULL
    `);

    // Now tighten to NOT NULL
    await queryInterface.changeColumn('Rentals', 'target_user_type', {
      type: Sequelize.STRING(50),
      allowNull: false
    });

    // Remove columns that are no longer used
    await queryInterface.removeColumn('Rentals', 'merchant_id');
    await queryInterface.removeColumn('Rentals', 'is_default');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('Rentals', 'is_default', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.addColumn('Rentals', 'merchant_id', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
    await queryInterface.removeColumn('Rentals', 'target_user_type');
  }
};

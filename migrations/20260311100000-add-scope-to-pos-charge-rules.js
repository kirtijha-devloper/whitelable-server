'use strict';

/**
 * Add a `scope` column to pos_charge_rules that explicitly labels each rule's
 * tier in the resolution hierarchy.  Then back-fill existing rows based on the
 * current user_id / franchaise_id / created_by values.
 *
 * Possible values:
 *   admin_default       – global default set by admin
 *   admin_franchise     – franchise-specific rule set by admin
 *   admin_merchant      – merchant-specific rule set by admin (non-franchised merchant)
 *   franchise_default   – default for all merchants under a franchise, set by the franchise
 *   franchise_merchant  – merchant-specific rule set by the franchise
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. add the column with a temporary default so NOT NULL is satisfied
    await queryInterface.addColumn('pos_charge_rules', 'scope', {
      type: Sequelize.STRING(30),
      allowNull: false,
      defaultValue: 'admin_default',
      comment: 'Rule tier: admin_default | admin_franchise | admin_merchant | franchise_default | franchise_merchant'
    });

    // 2. back-fill existing rows
    // franchise_merchant: created_by = franchaise_id AND user_id IS NOT NULL
    await queryInterface.sequelize.query(`
      UPDATE pos_charge_rules
      SET scope = 'franchise_merchant'
      WHERE user_id IS NOT NULL
        AND franchaise_id IS NOT NULL
        AND created_by IS NOT NULL
        AND created_by = franchaise_id
    `);

    // franchise_default: created by franchise, no specific merchant
    await queryInterface.sequelize.query(`
      UPDATE pos_charge_rules
      SET scope = 'franchise_default'
      WHERE user_id IS NULL
        AND franchaise_id IS NOT NULL
        AND created_by IS NOT NULL
        AND created_by = franchaise_id
        AND scope != 'franchise_merchant'
    `);

    // admin_franchise: franchaise_id set but created by admin (created_by != franchaise_id OR created_by IS NULL)
    await queryInterface.sequelize.query(`
      UPDATE pos_charge_rules
      SET scope = 'admin_franchise'
      WHERE user_id IS NULL
        AND franchaise_id IS NOT NULL
        AND (created_by IS NULL OR created_by != franchaise_id)
        AND scope NOT IN ('franchise_default','franchise_merchant')
    `);

    // admin_merchant: user_id set, no franchise
    await queryInterface.sequelize.query(`
      UPDATE pos_charge_rules
      SET scope = 'admin_merchant'
      WHERE user_id IS NOT NULL
        AND franchaise_id IS NULL
        AND scope NOT IN ('franchise_merchant')
    `);

    // everything else stays admin_default (the column default)

    // 3. index for faster lookups by scope
    await queryInterface.addIndex('pos_charge_rules', ['scope'], {
      name: 'idx_pos_charge_rules_scope'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('pos_charge_rules', 'idx_pos_charge_rules_scope');
    await queryInterface.removeColumn('pos_charge_rules', 'scope');
  }
};

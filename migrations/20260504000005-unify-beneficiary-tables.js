'use strict';

/**
 * Unifies Beneficiaries and payout_beneficiaries into a single Beneficiaries table.
 *
 * Changes:
 *  1. Renames bank_branch_name → branch_name in Beneficiaries.
 *  2. Adds state column (nullable; enforced at app level for Vimo, not required for BranchX).
 *  3. Copies all existing rows from payout_beneficiaries into Beneficiaries.
 *
 * After running this migration:
 *  - vimoController uses the Beneficiary model scoped by merchant_id (was user_id).
 *  - payout_beneficiaries table is left intact as a backup; drop it once confirmed.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Rename bank_branch_name → branch_name, then relax the NOT NULL constraint
    //    (the original add-brancg-benef migration created it as allowNull: false).
    await queryInterface.renameColumn('Beneficiaries', 'bank_branch_name', 'branch_name');
    await queryInterface.changeColumn('Beneficiaries', 'branch_name', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    });

    // 2. Add state column
    await queryInterface.addColumn('Beneficiaries', 'state', {
      type: Sequelize.STRING(255),
      allowNull: true,
      defaultValue: null,
    });

    // 3. Migrate rows from payout_beneficiaries → Beneficiaries
    const rows = await queryInterface.sequelize.query(
      'SELECT user_id, name, account_number, ifsc_code, bank_name, branch_name, state, mobile, email, is_verified, created_at, updated_at FROM payout_beneficiaries',
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    if (rows.length > 0) {
      const now = new Date();
      await queryInterface.bulkInsert('Beneficiaries', rows.map(r => ({
        merchant_id:      r.user_id,
        beneficiary_name: r.name,
        mobile_number:    r.mobile || '',
        bank_name:        r.bank_name,
        account_number:   r.account_number,
        ifsc_code:        r.ifsc_code,
        email:            r.email || '',
        status:           r.is_verified ? 'verified' : 'active',
        branch_name:      r.branch_name || null,
        state:            r.state || null,
        createdAt:        r.created_at || now,
        updatedAt:        r.updated_at || now,
      })));
    }
  },

  async down(queryInterface, Sequelize) {
    // Remove added columns; migrated rows are not reversed (payout_beneficiaries still intact).
    await queryInterface.removeColumn('Beneficiaries', 'state');
    await queryInterface.renameColumn('Beneficiaries', 'branch_name', 'bank_branch_name');
  },
};

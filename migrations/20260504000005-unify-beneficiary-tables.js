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
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // 1. Rename bank_branch_name → branch_name (idempotent: skip if already renamed)
      const columns = await queryInterface.describeTable('Beneficiaries');
      if (columns['bank_branch_name']) {
        await queryInterface.renameColumn('Beneficiaries', 'bank_branch_name', 'branch_name', { transaction });
      }

      // 2. Relax the NOT NULL constraint on branch_name (it was created allowNull: false)
      await queryInterface.changeColumn('Beneficiaries', 'branch_name', {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: null,
      }, { transaction });

      // 3. Add state column (idempotent: skip if already present)
      const columnsAfter = await queryInterface.describeTable('Beneficiaries');
      if (!columnsAfter['state']) {
        await queryInterface.addColumn('Beneficiaries', 'state', {
          type: Sequelize.STRING(255),
          allowNull: true,
          defaultValue: null,
        }, { transaction });
      }

      // 4. Migrate rows from payout_beneficiaries → Beneficiaries
      const rows = await queryInterface.sequelize.query(
        'SELECT user_id, name, account_number, ifsc_code, bank_name, branch_name, state, mobile, email, is_verified, created_at, updated_at FROM payout_beneficiaries',
        { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
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
        })), { transaction });
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.removeColumn('Beneficiaries', 'state', { transaction });
      await queryInterface.changeColumn('Beneficiaries', 'branch_name', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'N/A',
      }, { transaction });
      await queryInterface.renameColumn('Beneficiaries', 'branch_name', 'bank_branch_name', { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};

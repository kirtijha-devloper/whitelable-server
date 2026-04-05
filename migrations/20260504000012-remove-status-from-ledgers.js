'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Drop the trigger that references status in its UPDATE OF clause
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trg_ledger_wallet_sync ON "Ledgers";
    `);

    await queryInterface.removeColumn('Ledgers', 'status');

    // Recreate trigger without status column
    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_ledger_wallet_sync
      AFTER INSERT OR DELETE OR UPDATE OF debit, credit
      ON "Ledgers"
      FOR EACH ROW EXECUTE FUNCTION sync_user_wallet_fn();
    `);
  },

  async down(queryInterface, Sequelize) {
    // Drop the trigger so we can recreate it with status after restoring the column
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trg_ledger_wallet_sync ON "Ledgers";
    `);

    await queryInterface.addColumn('Ledgers', 'status', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'completed',
      comment: 'Restored by migration rollback'
    });

    // Restore original trigger definition
    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_ledger_wallet_sync
      AFTER INSERT OR DELETE OR UPDATE OF debit, credit, status
      ON "Ledgers"
      FOR EACH ROW EXECUTE FUNCTION sync_user_wallet_fn();
    `);
  }
};

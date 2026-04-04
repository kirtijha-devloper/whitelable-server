'use strict';

/**
 * Migration: fix-wallet-sync-trigger-remove-status-filter
 *
 * Migration 20260504000012 removed the `status` column from Ledgers and
 * updated the trigger's UPDATE OF clause, but did not update the body of
 * sync_user_wallet_fn() which still queries:
 *   AND status = 'completed'
 *
 * That causes every INSERT into Ledgers to fail at the trigger with:
 *   ERROR: column "status" does not exist
 *
 * This migration replaces the function body to remove the status filter so
 * the wallet sum covers ALL rows (which is correct — all ledger entries count
 * toward the balance regardless of former status).
 */

module.exports = {
  async up(queryInterface) {
    // Drop the trigger first so the function can be replaced safely.
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trg_ledger_wallet_sync ON "Ledgers";
    `);

    // Replace the trigger function — remove the AND status = 'completed' filter.
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION sync_user_wallet_fn()
      RETURNS TRIGGER AS $$
      DECLARE
        v_user_id  INTEGER;
        v_balance  DECIMAL(10,2);
      BEGIN
        IF TG_OP = 'DELETE' THEN
          v_user_id := OLD.user_id;
        ELSE
          v_user_id := NEW.user_id;
        END IF;

        -- Rebuild balance_before/balance on every row for this user.
        -- This UPDATE only touches those two columns so it will NOT re-fire
        -- this trigger (which is guarded by UPDATE OF debit, credit).
        PERFORM rebuild_ledger_chain_fn(v_user_id);

        -- Sync user.wallet to the ground-truth sum of all ledger entries.
        SELECT COALESCE(SUM(credit), 0) - COALESCE(SUM(debit), 0)
          INTO v_balance
          FROM "Ledgers"
         WHERE user_id = v_user_id;

        UPDATE "Users"
           SET wallet = v_balance
         WHERE id = v_user_id;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Recreate the trigger without the status column reference.
    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_ledger_wallet_sync
      AFTER INSERT OR DELETE OR UPDATE OF debit, credit
      ON "Ledgers"
      FOR EACH ROW EXECUTE FUNCTION sync_user_wallet_fn();
    `);
  },

  async down(queryInterface) {
    // Restore the function body that referenced status (for rollback only —
    // rolling back also requires restoring the status column first via
    // rolling back 20260504000012).
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trg_ledger_wallet_sync ON "Ledgers";
    `);

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION sync_user_wallet_fn()
      RETURNS TRIGGER AS $$
      DECLARE
        v_user_id  INTEGER;
        v_balance  DECIMAL(10,2);
      BEGIN
        IF TG_OP = 'DELETE' THEN
          v_user_id := OLD.user_id;
        ELSE
          v_user_id := NEW.user_id;
        END IF;

        PERFORM rebuild_ledger_chain_fn(v_user_id);

        SELECT COALESCE(SUM(credit), 0) - COALESCE(SUM(debit), 0)
          INTO v_balance
          FROM "Ledgers"
         WHERE user_id = v_user_id
           AND status  = 'completed';

        UPDATE "Users"
           SET wallet = v_balance
         WHERE id = v_user_id;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_ledger_wallet_sync
      AFTER INSERT OR DELETE OR UPDATE OF debit, credit, status
      ON "Ledgers"
      FOR EACH ROW EXECUTE FUNCTION sync_user_wallet_fn();
    `);
  },
};

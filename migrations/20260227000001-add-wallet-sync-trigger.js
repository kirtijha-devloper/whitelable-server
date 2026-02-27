'use strict';

/**
 * Migration: add-wallet-sync-trigger
 *
 * Creates two PostgreSQL functions and one trigger that keep the entire
 * Ledger balance chain — plus Users.wallet — consistent whenever a row is
 * inserted, updated (debit/credit/status columns), or deleted in the
 * Ledgers table.
 *
 * ── What is the "balance chain"? ─────────────────────────────────────────
 * Every Ledger row stores:
 *   balance_before  = wallet before this transaction
 *   balance         = wallet after this transaction  (= before + credit - debit)
 *
 * getLatestBalance() reads the `balance` column of the most-recent row, not
 * SUM(credit-debit).  If a row is manually inserted or deleted, later rows
 * still carry their original stale values, so the next application-written
 * insert computes a wrong balance_before/balance.
 *
 * ── Functions created ────────────────────────────────────────────────────
 * 1. rebuild_ledger_chain_fn(p_user_id)
 *    A single window-function UPDATE that rewrites balance_before and balance
 *    on every Ledger row for the user in chronological order.
 *    Updating only balance_before/balance does NOT re-fire the trigger because
 *    the trigger condition covers only (debit, credit, status).
 *
 * 2. sync_user_wallet_fn()  — the trigger function
 *    Calls rebuild_ledger_chain_fn(), then recomputes Users.wallet from
 *    SUM(credit-debit) of completed rows.
 *
 * ── Trigger created ──────────────────────────────────────────────────────
 * trg_ledger_wallet_sync
 *   AFTER INSERT OR UPDATE OF debit, credit, status OR DELETE
 *   FOR EACH ROW
 *
 * For normal application inserts the chain rebuild is a near-no-op UPDATE
 * (all values already correct).  For manual DB changes it fully repairs both
 * the chain and Users.wallet automatically.
 */

module.exports = {
  async up(queryInterface) {
    // ── 1. Chain-rebuild helper ───────────────────────────────────────────
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION rebuild_ledger_chain_fn(p_user_id INTEGER)
      RETURNS VOID AS $$
      BEGIN
        UPDATE "Ledgers" AS l
        SET
          balance_before = sub.running_before,
          balance        = sub.running_after
        FROM (
          SELECT
            id,
            COALESCE(SUM(credit - debit) OVER (
              PARTITION BY user_id
              ORDER BY "createdAt" ASC, id ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0) AS running_before,
            COALESCE(SUM(credit - debit) OVER (
              PARTITION BY user_id
              ORDER BY "createdAt" ASC, id ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ), 0) AS running_after
          FROM "Ledgers"
          WHERE user_id = p_user_id
        ) sub
        WHERE l.id = sub.id;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // ── 2. Trigger function ───────────────────────────────────────────────
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
        -- this trigger (which is guarded by UPDATE OF debit, credit, status).
        PERFORM rebuild_ledger_chain_fn(v_user_id);

        -- Sync user.wallet to the ground-truth sum of completed entries
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

    // ── 3. Drop + recreate trigger (idempotent) ───────────────────────────
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trg_ledger_wallet_sync ON "Ledgers";
    `);

    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_ledger_wallet_sync
      AFTER INSERT OR UPDATE OF debit, credit, status OR DELETE
      ON "Ledgers"
      FOR EACH ROW
      EXECUTE FUNCTION sync_user_wallet_fn();
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trg_ledger_wallet_sync ON "Ledgers";
    `);
    await queryInterface.sequelize.query(`
      DROP FUNCTION IF EXISTS sync_user_wallet_fn();
    `);
    await queryInterface.sequelize.query(`
      DROP FUNCTION IF EXISTS rebuild_ledger_chain_fn(INTEGER);
    `);
  },
};

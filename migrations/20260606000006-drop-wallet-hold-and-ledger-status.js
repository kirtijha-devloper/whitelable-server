'use strict';

async function describeTableSafe(queryInterface, tableName) {
  try {
    return await queryInterface.describeTable(tableName);
  } catch (error) {
    return {};
  }
}

const rebuildLedgerChainSql = `
  CREATE OR REPLACE FUNCTION rebuild_ledger_chain_fn(p_user_id INTEGER)
  RETURNS VOID AS $$
  BEGIN
    UPDATE "Ledgers" AS l
    SET
      balance_before = sub.running_before,
      balance = sub.running_after
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
`;

const syncWalletWithoutStatusSql = `
  CREATE OR REPLACE FUNCTION sync_user_wallet_fn()
  RETURNS TRIGGER AS $$
  DECLARE
    v_user_id INTEGER;
    v_balance DECIMAL(10,2);
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
     WHERE user_id = v_user_id;

    UPDATE "Users"
       SET wallet = v_balance
     WHERE id = v_user_id;

    RETURN NULL;
  END;
  $$ LANGUAGE plpgsql;
`;

const syncWalletWithStatusSql = `
  CREATE OR REPLACE FUNCTION sync_user_wallet_fn()
  RETURNS TRIGGER AS $$
  DECLARE
    v_user_id INTEGER;
    v_balance DECIMAL(10,2);
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
       AND status = 'completed';

    UPDATE "Users"
       SET wallet = v_balance
     WHERE id = v_user_id;

    RETURN NULL;
  END;
  $$ LANGUAGE plpgsql;
`;

module.exports = {
  async up(queryInterface, Sequelize) {
    const userTable = await describeTableSafe(queryInterface, 'Users');
    if (userTable.wallet_hold) {
      await queryInterface.removeColumn('Users', 'wallet_hold');
    }

    const ledgerTable = await describeTableSafe(queryInterface, 'Ledgers');
    if (!Object.keys(ledgerTable).length) {
      return;
    }

    await queryInterface.sequelize.query('DROP TRIGGER IF EXISTS trg_ledger_wallet_sync ON "Ledgers";');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_ledgers_status;');

    if (ledgerTable.status) {
      await queryInterface.removeColumn('Ledgers', 'status');
    }

    await queryInterface.sequelize.query(rebuildLedgerChainSql);
    await queryInterface.sequelize.query(syncWalletWithoutStatusSql);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_ledger_wallet_sync
      AFTER INSERT OR UPDATE OF debit, credit OR DELETE
      ON "Ledgers"
      FOR EACH ROW
      EXECUTE FUNCTION sync_user_wallet_fn();
    `);
  },

  async down(queryInterface, Sequelize) {
    const userTable = await describeTableSafe(queryInterface, 'Users');
    if (!userTable.wallet_hold) {
      await queryInterface.addColumn('Users', 'wallet_hold', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      });
    }

    const ledgerTable = await describeTableSafe(queryInterface, 'Ledgers');
    if (!Object.keys(ledgerTable).length) {
      return;
    }

    await queryInterface.sequelize.query('DROP TRIGGER IF EXISTS trg_ledger_wallet_sync ON "Ledgers";');

    const latestLedgerTable = await describeTableSafe(queryInterface, 'Ledgers');
    if (!latestLedgerTable.status) {
      await queryInterface.addColumn('Ledgers', 'status', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'completed',
      });
      await queryInterface.addIndex('Ledgers', ['status'], { name: 'idx_ledgers_status' });
    }

    await queryInterface.sequelize.query(rebuildLedgerChainSql);
    await queryInterface.sequelize.query(syncWalletWithStatusSql);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_ledger_wallet_sync
      AFTER INSERT OR UPDATE OF debit, credit, status OR DELETE
      ON "Ledgers"
      FOR EACH ROW
      EXECUTE FUNCTION sync_user_wallet_fn();
    `);
  },
};

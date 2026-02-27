/**
 * Finds and kills any MySQL/MariaDB transactions that have been open for
 * more than 30 seconds or are stuck in LOCK WAIT state.
 * Run once to unblock a hanging wallet request.
 *
 *   node scripts/killStuckTxns.js
 */
require("dotenv").config();
const db = require("../config/database");

(async () => {
  try {
    let rows = [];
    if (db.getDialect && db.getDialect() === 'postgres') {
      // look for transactions running longer than 30 seconds or waiting
      [rows] = await db.query(`
        SELECT pid AS thread_id, state, query, query_start
        FROM pg_stat_activity
        WHERE state <> 'idle'
          AND now() - query_start > INTERVAL '30 seconds'
      `);
    } else {
      // assume mysql-like
      [rows] = await db.query(`
        SELECT trx_id, trx_state, trx_started, trx_mysql_thread_id AS thread_id, trx_query AS query
        FROM information_schema.innodb_trx
        WHERE trx_state = 'LOCK WAIT'
           OR trx_started < NOW() - INTERVAL 30 SECOND
      `);
    }

    if (!rows.length) {
      console.log("✅ No stuck transactions found.");
      return;
    }

    console.log(`Found ${rows.length} stuck transaction(s):\n`);
    console.table(rows.map(r => ({
      thread_id: r.thread_id,
      state:     r.state,
      started:   r.trx_started || r.query_start,
      query:     (r.query || "").slice(0, 80),
    })));

    for (const row of rows) {
      const tid = row.thread_id;
      if (db.getDialect && db.getDialect() === 'postgres') {
        await db.query(`SELECT pg_terminate_backend(${tid})`);
      } else {
        await db.query(`KILL ${tid}`);
      }
      console.log(`🔪 Killed backend ${tid}`);
    }
    console.log("\nDone. Retry your wallet request.");
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await db.close();
  }
})();

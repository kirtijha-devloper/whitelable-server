require('dotenv').config();
const db = require('../config/database');

const tables = ['Users', 'PosMachines', 'PosTransactionCharges', 'CommissionDefaults', 'UserCommissions'];

async function fix() {
  await db.authenticate();
  for (const t of tables) {
    try {
      const sql = `SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM "${t}"`;
      await db.query(sql);
      console.log(`✅ Sequence reset: ${t}`);
    } catch (e) {
      console.warn(`⚠️  Skipped ${t}: ${e.message}`);
    }
  }
  process.exit(0);
}

fix().catch(e => { console.error(e.message); process.exit(1); });

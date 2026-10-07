require('dotenv').config();
const db = require('../config/database');

async function main() {
  await db.authenticate();
  await db.query('ALTER TABLE "Companies" ADD COLUMN IF NOT EXISTS "company_logo" VARCHAR(500);');
  console.log('company_logo column successfully ensured on Companies table');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


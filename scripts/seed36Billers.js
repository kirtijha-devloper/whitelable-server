/**
 * Script to seed 36 Credit Card Billers into POS-SERVER database (BillAvenueBillers table)
 * Run: node scripts/seed36Billers.js
 */

const { autoSeedBillAvenueBillers } = require('../services/cc/billAvenue/billAvenueSeeder');

async function run() {
  console.log('--- Seeding BillAvenue Billers into Database ---');
  await autoSeedBillAvenueBillers();
  console.log('--- Done! ---');
  process.exit(0);
}

run();

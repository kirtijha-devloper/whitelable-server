/**
 * Migration: Create shared_token_cache table
 * Run: node scripts/migrate_shared_token_cache.js
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const db = require('../config/database');
const SharedTokenCache = require('../models/SharedTokenCache');

async function run() {
  try {
    await db.authenticate();
    console.log('DB connected.');
    await SharedTokenCache.sync({ alter: true });
    console.log('shared_token_cache table created/updated successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

run();

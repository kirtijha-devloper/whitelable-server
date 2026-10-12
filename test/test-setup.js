process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';
const db = require('../config/database');
require('../models');

before(async () => {
  try {
    await db.query('PRAGMA foreign_keys = OFF;');
  } catch (_e) {}
  try {
    await db.sync();
  } catch (_e) {
    for (const model of Object.values(db.models)) {
      try {
        await model.sync();
      } catch (_mErr) {}
    }
  }
});

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';
const db = require('../config/database');
require('../models');

before(async () => {
  try {
    await db.sync();
  } catch (_e) {}
});

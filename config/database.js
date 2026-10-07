require('dotenv').config();
const Sequelize = require('sequelize');

// For test environment use an in-memory sqlite database (no env vars required)
if (process.env.NODE_ENV === 'test') {
  const sqliteConfig = {
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false
  };
  const db = new Sequelize({ ...sqliteConfig });
  console.log('Using sqlite in-memory DB for tests');
  module.exports = db;
} else {
  // Validate required DB env vars and provide a clear error if missing
  const requiredVars = ['DB_NAME', 'DB_USER', 'DB_PASS', 'DB_HOST', 'DB_DIALECT'];
  const missing = requiredVars.filter((v) => process.env[v] === undefined);
  if (missing.length) {
    throw new Error(`Missing required DB env vars: ${missing.join(', ')}. Check your .env or PM2 config.`);
  }

  // Construct config with sensible default port based on dialect
  const dbConfig = {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT, // e.g., 'postgres', 'mysql'
    port: process.env.DB_PORT || (process.env.DB_DIALECT === 'postgres' ? '5432' : process.env.DB_DIALECT === 'mysql' ? '3306' : undefined),
    attributeBehavior: 'escape',
    // Enable SSL for cloud-hosted databases (e.g. Neon)
    ...( (process.env.DB_SSL === 'true' || (process.env.DB_HOST && process.env.DB_HOST.includes('neon.tech'))) && {
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      },
    }),
  };

  const db = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, dbConfig);
  // Quick connection test to report a clear success/failure message
  db.authenticate()
    .then(() => console.log('✅ DB connection successful'))
    .catch((err) => console.error('❌ DB connection failed:', err));

  module.exports = db;
}


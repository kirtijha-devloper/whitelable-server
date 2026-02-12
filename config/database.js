require('dotenv').config();
const Sequelize = require('sequelize');

// Validate required DB env vars and provide a clear error if missing
const requiredVars = ['DB_NAME', 'DB_USER', 'DB_PASS', 'DB_HOST', 'DB_DIALECT'];
const missing = requiredVars.filter((v) => !process.env[v]);
if (missing.length) {
  throw new Error(`Missing required DB env vars: ${missing.join(', ')}. Check your .env or PM2 config.`);
}

// Construct config with sensible default port based on dialect
const dbConfig = {
  host: process.env.DB_HOST,
  dialect: process.env.DB_DIALECT, // e.g., 'postgres', 'mysql'
  port: process.env.DB_PORT || (process.env.DB_DIALECT === 'postgres' ? '5432' : process.env.DB_DIALECT === 'mysql' ? '3306' : undefined),
  attributeBehavior: 'escape',
  logging: false,
  // logging: console.log
};

// Log DB params (password masked) so you can see what's being used at runtime
// console.log('DB params:', {
//   database: process.env.DB_NAME,
//   user: process.env.DB_USER,
//   host: dbConfig.host,
//   dialect: dbConfig.dialect,
//   port: dbConfig.port,
//   password: process.env.DB_PASS ? '****' : undefined
// });

const db = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, dbConfig);

// Quick connection test to report a clear success/failure message
db.authenticate()
  .then(() => console.log('✅ DB connection successful'))
  .catch((err) => console.error('❌ DB connection failed:', err));

module.exports = db;


require('dotenv').config();
const dbPass = String(process.env.DB_PASS || process.env.DB_PASSWORD || '');
module.exports = {
  development: {
    username: process.env.DB_USER || "postgres",
    password: dbPass || "pos@_2525",
    database: process.env.DB_NAME || "pos_abheepay",
    host: process.env.DB_HOST || '127.0.0.1',
    dialect: 'postgres',
  },
  staging: {
    username: process.env.DB_USER,
    password: dbPass || "pos@_2525",
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    dialect: 'postgres',
  },
  production: {
    username: process.env.DB_USER,
    password: dbPass || "pos@_2525",
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    dialect: 'postgres',
  }
};

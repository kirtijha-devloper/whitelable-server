require('dotenv').config();
const dbPass = String(process.env.DB_PASS || process.env.DB_PASSWORD || '');
const defaultDialect = process.env.DB_DIALECT || 'postgres';
const defaultPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : (defaultDialect === 'postgres' ? 5432 : 3306);

// Log config to help debug connection issues (password masked)
// console.log('Sequelize CLI Config:', {
//   username: process.env.DB_USER || "postgres",
//   database: process.env.DB_NAME || "pos_abheepay",
//   host: process.env.DB_HOST || '127.0.0.1',
//   port: defaultPort,
//   dialect: defaultDialect,
//   password: (dbPass || "pos@_2525") ? '****' : undefined
// });

module.exports = {
  development: {
    username: process.env.DB_USER || "postgres",
    password: dbPass || "pos@_2525",
    database: process.env.DB_NAME || "pos_abheepay",
    host: process.env.DB_HOST || '127.0.0.1',
    port: defaultPort,
    dialect: defaultDialect,
  },
  staging: {
    username: process.env.DB_USER,
    password: dbPass || "pos@_2525",
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: defaultPort,
    dialect: defaultDialect,
  },
  production: {
    username: process.env.DB_USER,
    password: dbPass || "pos@_2525",
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: defaultPort,
    dialect: defaultDialect,
  },
  test: {
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false
  },
  // configuration for CredXPay payout integration
  credxpay: {
    baseUrl: process.env.CREDXPAY_BASE_URL || '',
    apiKey: process.env.CREDXPAY_API_KEY || '',
    webhookIPs: (process.env.CREDXPAY_WEBHOOK_IPS || '')
      .split(',')
      .map(ip => ip.trim())
      .filter(ip => ip.length > 0)
  }
};

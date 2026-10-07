const fs = require('fs');
const path = require('path');

// Dynamically require all model files in this folder (except this file and index.js)
const models = {};
fs.readdirSync(__dirname)
  .filter((file) => file !== path.basename(__filename) && file !== 'index.js' && file.slice(-3) === '.js')
  .forEach((file) => {
    const model = require(path.join(__dirname, file));
    if (model && model.name) {
      models[model.name] = model;
    }
  });

// Execute associate() on each model if available
Object.values(models).forEach((m) => {
  if (m && typeof m.associate === 'function') {
    try {
      m.associate(models);
    } catch (err) {
      // Keep startup resilient and surface useful debug info
      // eslint-disable-next-line no-console
      console.error(`Error running associate() for model ${m.name}:`, err.message || err);
    }
  }
});

// friendly confirmation for dev logs
// eslint-disable-next-line no-console
console.log('Model associations initialized');

// Ensure company_logo column exists on Companies table safely
const db = require('../config/database');
db.query('ALTER TABLE "Companies" ADD COLUMN IF NOT EXISTS "company_logo" VARCHAR(500);')
  .catch((err) => {
    // Non-fatal if already exists or dialect difference
    console.warn('[Schema Init Warning] Could not ensure company_logo column:', err.message || err);
  });

module.exports = models;

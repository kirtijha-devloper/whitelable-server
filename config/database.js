require('dotenv').config();
const Sequelize = require('sequelize');
const db = new Sequelize(process.env.DB_NAME , process.env.DB_USER, process.env.DB_PASS, {
 host: process.env.DB_HOST,
 dialect: process.env.DB_DIALECT, // Change to your database type
  attributeBehavior: 'escape'
});

module.exports = db;
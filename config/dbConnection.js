const express = require("express");
const db = require('./database');

const connectDb = async () =>{ db.authenticate()
.then(() => console.log('Database connected 🎉'))
.catch((err) => console.error('❌ DB connection failed:', err))};

module.exports = connectDb
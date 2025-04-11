const Sequelize = require("sequelize");
const db = require("../config/database");

const OTP = db.define("Otp", {
  id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
  mobile: { type: Sequelize.STRING, allowNull: false },
  otp: { type: Sequelize.STRING, allowNull: false },
  purpose: { type: Sequelize.STRING }, // login or forgot_password
  expires_at: { type: Sequelize.DATE, allowNull: false }
});

module.exports = OTP;

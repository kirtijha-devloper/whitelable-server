const Sequelize = require('sequelize');
const db = require('../config/database');
const PosMachine = db.define('PosMachine', {
  id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      mid_number: {
        type: Sequelize.STRING
      },
      tid_number: {
        type: Sequelize.STRING
      },
      // razor_pa
      device_serial_number: {
        type: Sequelize.STRING
      },
      razorpay_id: {
        type: Sequelize.STRING
      },

      status: {
        type: Sequelize.STRING    
      },

      remarks: { type: Sequelize.STRING },
      company_name: {           // new nullable field to store company name
        type: Sequelize.STRING,
        allowNull: true
      },
      abheepay_id: { type: Sequelize.INTEGER },
      assigned_user_id: { type: Sequelize.INTEGER },
      franchaise_id: { type: Sequelize.INTEGER },
      created_by_user_id: { type: Sequelize.INTEGER },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
})

module.exports = PosMachine;
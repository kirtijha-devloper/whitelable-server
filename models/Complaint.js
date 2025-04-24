// models/Complaint.js
const Sequelize = require('sequelize');
const db = require('../config/database');
const User = require('../models/User');

const Complaint = db.define('Complaint', {
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },
    message: {
      type: Sequelize.TEXT,
      allowNull: false,
    },
    status: {
      type: Sequelize.ENUM('pending', 'resolved', 'closed'),
      defaultValue: 'pending',
    },
  }, {
    timestamps: true,
  });

  // Complaint.associate = function(models) {
  //   Complaint.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  // };


module.exports = Complaint;

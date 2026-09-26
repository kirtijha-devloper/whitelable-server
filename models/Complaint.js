const Sequelize = require('sequelize');
const db = require('../config/database');

const Complaint = db.define('Complaint', {
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },
    subject: {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'Help & Support Ticket',
    },
    category: {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'General',
    },
    message: {
      type: Sequelize.TEXT,
      allowNull: false,
    },
    admin_reply: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
    status: {
      type: Sequelize.ENUM('pending', 'in_progress', 'resolved', 'closed'),
      defaultValue: 'pending',
    },
  }, {
    timestamps: true,
  });

module.exports = Complaint;

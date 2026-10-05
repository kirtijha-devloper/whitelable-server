const Sequelize = require('sequelize');
const db = require('../config/database');

const Complaint = db.define('Complaint', {
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },
    company_id: {
      type: Sequelize.STRING,
      allowNull: true,
      references: {
        model: 'Companies',
        key: 'company_id',
      },
      comment: 'Company / white-label tenant identifier',
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

Complaint.associate = function(models) {
  Complaint.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user',
  });
  Complaint.belongsTo(models.Company, {
    foreignKey: 'company_id',
    targetKey: 'company_id',
    as: 'company',
  });
};

module.exports = Complaint;

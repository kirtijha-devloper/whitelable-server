const Sequelize = require('sequelize');
const db = require('../config/database');

const Tpin = db.define('Tpin', {
  id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: Sequelize.INTEGER, allowNull: false },
  company_id: {
    type: Sequelize.STRING,
    allowNull: true,
    references: {
      model: 'Companies',
      key: 'company_id',
    },
    comment: 'Company / white-label tenant identifier',
  },
  tpin: { type: Sequelize.STRING, allowNull: false },
  expires_at: { type: Sequelize.DATE, allowNull: false },
}, {
  timestamps: true,
});

Tpin.associate = function(models) {
  Tpin.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user',
  });
  Tpin.belongsTo(models.Company, {
    foreignKey: 'company_id',
    targetKey: 'company_id',
    as: 'company',
  });
};

module.exports = Tpin;

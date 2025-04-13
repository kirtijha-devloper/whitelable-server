const Sequelize = require('sequelize');
const db = require('../config/database');

const Remitter = db.define('Remitter', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
    merchant_id: {  // basically this merhcant id means here all user id, could be franchaise id.
        type: Sequelize.INTEGER,
        allowNull: false
    },
  mobile_number: {
    type: Sequelize.STRING,
    allowNull: false,
    unique: true
  },
  name: {
    type: Sequelize.STRING,
    allowNull: false
  },
  status: {type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'active'},
  external_reference_id: {
    type: Sequelize.STRING,
    allowNull: true // if sdds returns a reference ID
  }
}, {
  timestamps: true
});

module.exports = Remitter;

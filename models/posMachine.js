// 'use strict';
// const {
//   Model
// } = require('sequelize');
// module.exports = (sequelize, DataTypes) => {
//   class PosMachine extends Model {
//     /**
//      * Helper method for defining associations.
//      * This method is not a part of Sequelize lifecycle.
//      * The `models/index` file will call this method automatically.
//      */
//     static associate(models) {
//       // define association here
//     }
//   }
//   PosMachine.init({
//     mid_number: DataTypes.INTEGER
//   }, {
//     sequelize,
//     modelName: 'PosMachine',
//   });
//   return PosMachine;
// };

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
        type: Sequelize.INTEGER
      },
      tid_number: {
        type: Sequelize.INTEGER
      },
      device_serial_number: {
        type: Sequelize.INTEGER
      },
      status: {
        type: Sequelize.STRING    
      },

      reamrks: { type: Sequelize.STRING },
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
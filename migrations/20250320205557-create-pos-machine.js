'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PosMachines', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      mid_number: {
        allowNull: false,
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

      reamrks: {
        type: Sequelize.STRING
      },
      abheepay_id: { type: Sequelize.INTEGER },
      assigned_user_id: { type: Sequelize.INTEGER },
      franchaise_id: { type: Sequelize.INTEGER },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('PosMachines');
  }
};
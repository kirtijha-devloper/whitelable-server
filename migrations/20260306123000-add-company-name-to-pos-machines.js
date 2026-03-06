'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // add a nullable company_name column to PosMachines
    await queryInterface.addColumn('PosMachines', 'company_name', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('PosMachines', 'company_name');
  }
};

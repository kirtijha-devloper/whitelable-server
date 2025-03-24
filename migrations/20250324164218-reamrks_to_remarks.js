'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Rename column 'reamrks' to 'remarks' in PosMachines table
    await queryInterface.renameColumn('PosMachines', 'reamrks', 'remarks');
  },

  async down(queryInterface, Sequelize) {
    // Revert the column name back to 'reamrks' if needed
    await queryInterface.renameColumn('PosMachines', 'remarks', 'reamrks');
  }
};

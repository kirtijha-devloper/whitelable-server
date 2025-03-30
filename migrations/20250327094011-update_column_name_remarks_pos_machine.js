'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('PosMachines');

    if (table.reamrks) {
      return queryInterface.renameColumn('PosMachines', 'reamrks', 'remarks');
    } else {
      console.log("Column 'reamrks' does not exist. Skipping rename.");
      return Promise.resolve();
    }
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('PosMachines');

    if (table.remarks) {
      return queryInterface.renameColumn('PosMachines', 'remarks', 'reamrks');
    } else {
      console.log("Column 'remarks' does not exist. Skipping rename.");
      return Promise.resolve();
    }
  }
};


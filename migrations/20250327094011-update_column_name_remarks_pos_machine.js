'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.renameColumn('PosMachines', 'reamrks', 'remarks');
  },

  async down(queryInterface, Sequelize) {
    return queryInterface.renameColumn('PosMachines', 'remarks', 'reamrks');
  }
};

'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('PosMachines', 'bank_name', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
      comment: 'Optional bank name for the POS machine'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('PosMachines', 'bank_name');
  }
};

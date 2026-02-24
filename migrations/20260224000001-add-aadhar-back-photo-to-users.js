'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'aadhar_back_number_url', {
      type: Sequelize.STRING,
      allowNull: true,
      after: 'aadhar_number_url',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'aadhar_back_number_url');
  },
};

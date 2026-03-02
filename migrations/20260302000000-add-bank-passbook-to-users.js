'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // add a nullable column for storing the Cloudinary URL of the uploaded passbook image
    await queryInterface.addColumn('Users', 'bank_passbook_url', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Users', 'bank_passbook_url');
  }
};
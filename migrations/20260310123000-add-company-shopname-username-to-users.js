'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    // add nullable company_or_shop_name and username, username unique
    await queryInterface.addColumn('Users', 'company_or_shop_name', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Optional company or shop name provided by user'
    });

    await queryInterface.addColumn('Users', 'username', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
      comment: 'System-generated login username (not supplied by frontend)'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Users', 'username');
    await queryInterface.removeColumn('Users', 'company_or_shop_name');
  }
};

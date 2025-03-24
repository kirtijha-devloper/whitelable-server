'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('Users', 'mobile_number_country_code', {
      type: Sequelize.STRING,
      allowNull: true
    });
     await queryInterface.changeColumn('Users', 'name', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.changeColumn('Users', 'mobile_number', {
      type: Sequelize.STRING,
      allowNull: true
    });

     await queryInterface.changeColumn('Users', 'organization_name', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('Users', 'mobile_number_country_code', {
      type: Sequelize.STRING,
      allowNull: false
    });
    await queryInterface.changeColumn('Users', 'name', {
      type: Sequelize.STRING,
      allowNull: false
    });
    await queryInterface.changeColumn('Users', 'mobile_number', {
      type: Sequelize.STRING,
      allowNull: false
    });
     await queryInterface.changeColumn('Users', 'organization_name', {
      type: Sequelize.STRING,
      allowNull: false
    });
  }
};

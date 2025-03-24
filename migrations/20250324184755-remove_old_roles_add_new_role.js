'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Users', 'is_admin');
    await queryInterface.removeColumn('Users', 'is_franchise');
    await queryInterface.removeColumn('Users', 'is_merchant');
    await queryInterface.removeColumn('Users', 'is_pos_asigned');

    await queryInterface.addColumn('Users', 'role', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'merchant'
    });
    await queryInterface.addColumn('Users', 'organization_name', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'is_admin', {
    type: Sequelize.BOOLEAN,
    defaultValue: false
    });
    await queryInterface.addColumn('Users', 'is_franchise', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });
    await queryInterface.addColumn('Users', 'is_merchant', {
      type: Sequelize.BOOLEAN,
      defaultValue: true
    });

    await queryInterface.removeColumn('Users', 'role');
    }
};

'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Alter column to change from INTEGER to STRING (VARCHAR)
    await queryInterface.changeColumn('PosMachines', 'mid_number', {
      type: Sequelize.STRING,
      allowNull: false, // or true if optional
    });
    await queryInterface.changeColumn('PosMachines', 'tid_number', {
      type: Sequelize.STRING,
      allowNull: false, // or true if optional
    });

    await queryInterface.changeColumn('PosMachines', 'device_serial_number', {
      type: Sequelize.STRING,
      allowNull: false, // or true if optional
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Revert it back to INTEGER (optional, only if you're confident the values can be casted)
    await queryInterface.changeColumn('PosMachines', 'mid_number', {
      type: Sequelize.INTEGER, // Use BIGINT if the number is large
      allowNull: false,
    });
    await queryInterface.changeColumn('PosMachines', 'tid_number', {
      type: Sequelize.INTEGER, // Use BIGINT if the number is large
      allowNull: false,
    });
    await queryInterface.changeColumn('PosMachines', 'device_serial_number', {
      type: Sequelize.INTEGER,
      allowNull: false, // or true if optional
    });
  }
};

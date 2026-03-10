'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('username_sequences', {
      prefix: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false
      },
      current_value: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('username_sequences');
  }
};

'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pos_machine_assignment_logs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      pos_machine_id: {
        allowNull: false,
        type: Sequelize.INTEGER
      },
      action: {
        allowNull: false,
        type: Sequelize.STRING(50)
      },
      assigned_from_user_id: {
        type: Sequelize.INTEGER
      },
      assigned_to_user_id: {
        type: Sequelize.INTEGER
      },
      performed_by_user_id: {
        type: Sequelize.INTEGER
      },
      details: {
        type: Sequelize.JSONB
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    await queryInterface.addIndex('pos_machine_assignment_logs', ['pos_machine_id']);
    await queryInterface.addIndex('pos_machine_assignment_logs', ['performed_by_user_id']);
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('pos_machine_assignment_logs');
  }
};

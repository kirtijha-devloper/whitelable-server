'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Beneficiaries', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false
    },
    remitter_id: {type: Sequelize.INTEGER,
        allowNull: false},
      mobile: {
        type: Sequelize.STRING,
        allowNull: false
      },
      bank_name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      bank_account_number: {
        type: Sequelize.STRING,
        allowNull: false
      },
      bank_account_holder_name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      bank_ifsc: {
        type: Sequelize.STRING,
        allowNull: false
      },
      beneficiary_mobile: {
        type: Sequelize.STRING,
        allowNull: false
      },
      status: {
        type: Sequelize.INTEGER,
        defaultValue: 1
      },
      external_reference_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Beneficiaries');
  }
};

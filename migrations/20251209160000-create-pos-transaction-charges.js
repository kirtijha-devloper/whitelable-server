'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PosTransactionCharges', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      merchant_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      method: {
        type: Sequelize.STRING,
        allowNull: true
      },
      network: {
        type: Sequelize.STRING,
        allowNull: true
      },
      card_type: {
        type: Sequelize.STRING,
        allowNull: true
      },
      subtype: {
        type: Sequelize.STRING,
        allowNull: true
      },
      rate_percentage: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('PosTransactionCharges');
  }
};


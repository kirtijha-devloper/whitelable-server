'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('qr_inventory', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      qr_code: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      vpa_id: {
        type: Sequelize.STRING(150),
        allowNull: false,
        unique: true,
      },
      type: {
        type: Sequelize.STRING(100),
        allowNull: false,
        defaultValue: 'Acrylic Standee',
      },
      partner_bank: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      assigned_to: {
        type: Sequelize.STRING(150),
        allowNull: true,
        defaultValue: 'Unassigned',
      },
      status: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'unassigned',
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('qr_inventory');
  }
};

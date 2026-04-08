'use strict';

const SERVICE_KEYS = [
  'vimo_payout',
  'branchx_payout',
  'cc_bill_pay',
  'ba_cc_bill_pay',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('service_settings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      service_key: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      is_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      updated_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
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

    const now = new Date();

    await queryInterface.bulkInsert('service_settings', SERVICE_KEYS.map((serviceKey) => ({
      service_key: serviceKey,
      is_enabled: true,
      updated_by: null,
      createdAt: now,
      updatedAt: now,
    })));
  },

  async down(queryInterface) {
    await queryInterface.dropTable('service_settings');
  },
};

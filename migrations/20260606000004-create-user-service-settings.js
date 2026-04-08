'use strict';

const PAYOUT_SERVICE_KEYS = ['vimo_payout', 'branchx_payout'];
const DEFAULT_TRUE_SERVICE_KEYS = ['cc_bill_pay', 'ba_cc_bill_pay'];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_service_settings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      service_key: {
        type: Sequelize.STRING(100),
        allowNull: false,
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
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addConstraint('user_service_settings', {
      fields: ['user_id', 'service_key'],
      type: 'unique',
      name: 'user_service_settings_user_id_service_key_unique',
    });

    await queryInterface.addIndex('user_service_settings', ['user_id'], {
      name: 'user_service_settings_user_id_idx',
    });

    await queryInterface.addIndex('user_service_settings', ['service_key'], {
      name: 'user_service_settings_service_key_idx',
    });

    const usersTable = queryInterface.queryGenerator.quoteTable('Users');
    const [users] = await queryInterface.sequelize.query(
      `SELECT id, role, is_payout_enabled FROM ${usersTable}`
    );

    if (!Array.isArray(users) || users.length === 0) {
      return;
    }

    const now = new Date();
    const rows = [];

    for (const user of users) {
      const normalizedRole = user.role === 'franchise' ? 'franchaise' : user.role;
      if (!['merchant', 'franchaise'].includes(normalizedRole)) {
        continue;
      }

      const legacyPayoutEnabled = !(user.is_payout_enabled === false || user.is_payout_enabled === 0);

      for (const serviceKey of PAYOUT_SERVICE_KEYS) {
        rows.push({
          user_id: user.id,
          service_key: serviceKey,
          is_enabled: legacyPayoutEnabled,
          updated_by: null,
          updated_at: now,
        });
      }

      for (const serviceKey of DEFAULT_TRUE_SERVICE_KEYS) {
        rows.push({
          user_id: user.id,
          service_key: serviceKey,
          is_enabled: true,
          updated_by: null,
          updated_at: now,
        });
      }
    }

    await queryInterface.bulkInsert('user_service_settings', rows);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_service_settings');
  },
};

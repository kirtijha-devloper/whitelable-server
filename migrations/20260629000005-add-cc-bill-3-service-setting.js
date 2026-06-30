'use strict';

const SERVICE_KEY = 'cc_bill_3';
const TARGET_ROLES = new Set(['merchant', 'franchaise']);

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    await queryInterface.bulkInsert('service_settings', [{
      service_key: SERVICE_KEY,
      is_enabled: true,
      updated_by: null,
      createdAt: now,
      updatedAt: now,
    }], {
      ignoreDuplicates: true,
    });

    const usersTable = queryInterface.queryGenerator.quoteTable('Users');
    const [users] = await queryInterface.sequelize.query(
      `SELECT id, role FROM ${usersTable}`
    );

    if (!Array.isArray(users) || users.length === 0) {
      return;
    }

    const rows = users
      .filter((user) => TARGET_ROLES.has(user.role === 'franchise' ? 'franchaise' : user.role))
      .map((user) => ({
        user_id: user.id,
        service_key: SERVICE_KEY,
        is_enabled: true,
        updated_by: null,
        updated_at: now,
      }));

    if (rows.length === 0) {
      return;
    }

    await queryInterface.bulkInsert('user_service_settings', rows, {
      ignoreDuplicates: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('user_service_settings', {
      service_key: SERVICE_KEY,
    });

    await queryInterface.bulkDelete('service_settings', {
      service_key: SERVICE_KEY,
    });
  },
};

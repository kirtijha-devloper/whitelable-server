'use strict';

const SERVICES = [
  {
    service_key: 'pg_1',
    label: 'PG 1',
    category: 'Payment Gateway',
    description: 'Payment Gateway 1 service'
  },
  {
    service_key: 'pg_2',
    label: 'PG 2',
    category: 'Payment Gateway',
    description: 'Payment Gateway 2 service'
  }
];

const TARGET_ROLES = new Set(['merchant', 'franchise', 'franchaise', 'super_franchise', 'admin']);

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Insert into service_settings (Super Admin global toggle)
    for (const svc of SERVICES) {
      await queryInterface.bulkInsert('service_settings', [{
        service_key: svc.service_key,
        label: svc.label,
        category: svc.category,
        description: svc.description,
        is_enabled: true,
        target_roles: JSON.stringify(['merchant', 'franchise', 'super_franchise', 'admin']),
        updated_by: null,
        createdAt: now,
        updatedAt: now,
      }], {
        ignoreDuplicates: true,
      });
    }

    // 2. Fetch existing users to populate user_service_settings
    const usersTable = queryInterface.queryGenerator.quoteTable('Users');
    const [users] = await queryInterface.sequelize.query(
      `SELECT id, role, company_id FROM ${usersTable}`
    );

    if (!Array.isArray(users) || users.length === 0) {
      return;
    }

    const rows = [];
    for (const svc of SERVICES) {
      for (const user of users) {
        const normalizedRole = String(user.role || '').toLowerCase();
        if (TARGET_ROLES.has(normalizedRole)) {
          rows.push({
            user_id: user.id,
            company_id: user.company_id || null,
            service_key: svc.service_key,
            is_enabled: true,
            updated_by: null,
            updated_at: now,
          });
        }
      }
    }

    if (rows.length === 0) {
      return;
    }

    await queryInterface.bulkInsert('user_service_settings', rows, {
      ignoreDuplicates: true,
    });
  },

  async down(queryInterface) {
    const keys = SERVICES.map(s => s.service_key);
    await queryInterface.bulkDelete('user_service_settings', {
      service_key: keys,
    });
    await queryInterface.bulkDelete('service_settings', {
      service_key: keys,
    });
  },
};

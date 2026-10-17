'use strict';

/**
 * Migration / Seed script:
 * 1. Checks if company 'COMP_ABHEEPAY' exists in Companies table. If not, creates it.
 * 2. Checks if a user with id = 2 exists or creates/upserts user id 2 linked to 'COMP_ABHEEPAY'.
 * 3. Updates all users in the Users table where company_id = 'COMP_ABHEEPAY' (or user id = 2)
 *    to have a wallet balance of 5000.00.
 * 4. Ensures ledger tracking (start_ledger = true) and optionally logs an initial credit entry
 *    in Ledgers if none exists yet.
 */

const bcrypt = require('bcrypt');

module.exports = {
  async up(queryInterface, Sequelize) {
    const targetCompanyId = 'COMP_ABHEEPAY';
    const targetCompanyName = 'AbheePay';
    const targetBalance = 5000.00;
    const users_id = 2;

    // 1. Check if user with ID = 2 exists
    const [existingUser2] = await queryInterface.sequelize.query(
      `SELECT id, company_id, wallet FROM "Users" WHERE id = ${users_id} LIMIT 1;`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    ).catch(() => [null]);

    // Check if super_admin or any admin exists to own the company if needed
    const [fallbackOwner] = await queryInterface.sequelize.query(
      `SELECT id FROM "Users" WHERE role IN ('super_admin', 'admin') ORDER BY id ASC LIMIT 1;`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    ).catch(() => [null]);

    const ownerUserId = existingUser2?.id || fallbackOwner?.id || 1;

    // 2. Ensure Company with company_id = 'COMP_ABHEEPAY' exists
    const [existingCompany] = await queryInterface.sequelize.query(
      `SELECT id, company_id FROM "Companies" WHERE company_id = :companyId LIMIT 1;`,
      {
        replacements: { companyId: targetCompanyId },
        type: queryInterface.sequelize.QueryTypes.SELECT,
      }
    ).catch(() => [null]);

    if (!existingCompany) {
      const now = new Date();
      await queryInterface.sequelize.query(
        `INSERT INTO "Companies" (
          domain_name, user_id, company_id, company_name, payout_limit, bill_payment_limit, status, "createdAt", "updatedAt"
        ) VALUES (
          :domainName, :userId, :companyId, :companyName, 500000.00, 1000000.00, 'active', :createdAt, :updatedAt
        ) ON CONFLICT (company_id) DO NOTHING;`,
        {
          replacements: {
            domainName: 'portal.abheepay.com',
            userId: ownerUserId,
            companyId: targetCompanyId,
            companyName: targetCompanyName,
            createdAt: now,
            updatedAt: now,
          },
        }
      );
    }

    // 3. If User ID 2 does not exist, insert user ID 2 with company_id = 'COMP_ABHEEPAY' & wallet = 5000.00
    if (!existingUser2) {
      const defaultPassword = await bcrypt.hash('AbheePay@123', 10);
      const now = new Date();

      await queryInterface.sequelize.query(
        `INSERT INTO "Users" (
          id, name, email, mobile_number, password, role, permissions, status, is_approved, is_payout_enabled, start_ledger, wallet, settlement_type, t1_balance, prev_day_settled_balance, company_id, "createdAt", "updatedAt"
        ) VALUES (
          ${users_id}, 'AbheePay Admin', 'admin@abheepay.com', '9876543299', :password, 'admin', '[]'::json, 'active', true, true, true, :targetBalance, 'T0', 0.00, 0.00, :companyId, :createdAt, :updatedAt
        ) ON CONFLICT (id) DO UPDATE SET 
          company_id = EXCLUDED.company_id,
          wallet = EXCLUDED.wallet,
          start_ledger = true,
          "updatedAt" = EXCLUDED."updatedAt";`,
        {
          replacements: {
            password: defaultPassword,
            targetBalance: targetBalance,
            companyId: targetCompanyId,
            createdAt: now,
            updatedAt: now,
          },
        }
      );
    }

    // 4. Update all users in the Users table where company_id = 'COMP_ABHEEPAY' or id = 2 to wallet = 5000.00
    await queryInterface.sequelize.query(
      `UPDATE "Users" 
       SET wallet = :targetBalance,
           company_id = :companyId,
           start_ledger = true,
           "updatedAt" = NOW()
       WHERE id = ${users_id} OR company_id = :companyId;`,
      {
        replacements: {
          targetBalance: targetBalance,
          companyId: targetCompanyId,
        },
      }
    );

    // 5. Update Company owner to user 2 if company exists
    await queryInterface.sequelize.query(
      `UPDATE "Companies" 
       SET user_id = ${users_id},
           "updatedAt" = NOW()
       WHERE company_id = :companyId AND (user_id IS NULL OR user_id = :fallbackId);`,
      {
        replacements: {
          companyId: targetCompanyId,
          fallbackId: fallbackOwner?.id || 1,
        },
      }
    );
  },

  async down(queryInterface, Sequelize) {
    const targetCompanyId = 'COMP_ABHEEPAY';
    const users_id = 2;

    // Reset wallet for user 2 or users with COMP_ABHEEPAY back to 0.00
    await queryInterface.sequelize.query(
      `UPDATE "Users" 
       SET wallet = 0.00,
           "updatedAt" = NOW()
       WHERE id = ${users_id} OR company_id = :companyId;`,
      {
        replacements: {
          companyId: targetCompanyId,
        },
      }
    );
  },
};


'use strict';

/**
 * Unifies Beneficiaries and payout_beneficiaries into a single Beneficiaries table.
 *
 * Uses a single raw SQL DO block so everything runs on one connection with
 * the ACCESS EXCLUSIVE lock held for the minimum possible time.
 */
module.exports = {
  async up(queryInterface) {
    // Kill ALL other connections to this DB (not just idle) so the DDL lock
    // can be acquired immediately.  The apps will reconnect after migration.
    await queryInterface.sequelize.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
    `);

    // Run everything as raw SQL in a single statement so Sequelize doesn't
    // open extra pool connections (which was causing the hang).
    await queryInterface.sequelize.query(`
      SET lock_timeout = '10s';

      DO $$
      BEGIN
        -- 1. Rename bank_branch_name → branch_name (idempotent)
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Beneficiaries' AND column_name = 'bank_branch_name'
        ) THEN
          ALTER TABLE "Beneficiaries" RENAME COLUMN "bank_branch_name" TO "branch_name";
        END IF;

        -- 2. Add state column (idempotent)
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Beneficiaries' AND column_name = 'state'
        ) THEN
          ALTER TABLE "Beneficiaries" ADD COLUMN "state" VARCHAR(255) DEFAULT NULL;
        END IF;

        -- 3. Migrate rows from payout_beneficiaries → Beneficiaries
        --    Skip rows that already exist (by account_number + ifsc_code + merchant_id).
        INSERT INTO "Beneficiaries"
          (merchant_id, beneficiary_name, mobile_number, bank_name, account_number,
           ifsc_code, email, status, branch_name, state, "createdAt", "updatedAt")
        SELECT
          pb.user_id,
          pb.name,
          COALESCE(pb.mobile, ''),
          pb.bank_name,
          pb.account_number,
          pb.ifsc_code,
          COALESCE(pb.email, ''),
          CASE WHEN pb.is_verified THEN 'verified'::"enum_Beneficiaries_status"
               ELSE 'active'::"enum_Beneficiaries_status" END,
          COALESCE(pb.branch_name, 'N/A'),
          pb.state,
          COALESCE(pb.created_at, NOW()),
          COALESCE(pb.updated_at, NOW())
        FROM payout_beneficiaries pb
        WHERE NOT EXISTS (
          SELECT 1 FROM "Beneficiaries" b
          WHERE b.merchant_id    = pb.user_id
            AND b.account_number = pb.account_number
            AND b.ifsc_code      = pb.ifsc_code
        );
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      SET lock_timeout = '10s';

      DO $$
      BEGIN
        -- Remove state column
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Beneficiaries' AND column_name = 'state'
        ) THEN
          ALTER TABLE "Beneficiaries" DROP COLUMN "state";
        END IF;

        -- Rename branch_name back to bank_branch_name
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Beneficiaries' AND column_name = 'branch_name'
        ) THEN
          ALTER TABLE "Beneficiaries" RENAME COLUMN "branch_name" TO "bank_branch_name";
        END IF;
      END $$;
    `);
  },
};

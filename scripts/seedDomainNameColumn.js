/*
  Seed & migration script to add and initialize the `domain_name` column on the `Companies` table.

  Usage:
    node scripts/seedDomainNameColumn.js
    npm run seed:company-domain
*/

require('dotenv').config();
const db = require('../config/database');
const { QueryTypes } = require('sequelize');

async function seedDomainNameColumn() {
  try {
    await db.authenticate();
    console.log('✅ Connected to database successfully.');

    // 1. Check if "Companies" table exists
    const [tableExists] = await db.query(
      `SELECT to_regclass('"Companies"') AS table_name;`,
      { type: QueryTypes.SELECT }
    );

    if (!tableExists || !tableExists.table_name) {
      console.warn('⚠️ "Companies" table does not exist in the database. Please run migrations first.');
      process.exit(1);
    }

    // 2. Add domain_name column if it does not exist
    console.log('🔄 Ensuring "domain_name" column exists in "Companies" table...');
    await db.query(`
      ALTER TABLE "Companies" 
      ADD COLUMN IF NOT EXISTS "domain_name" VARCHAR(255);
    `);
    console.log('✅ "domain_name" column successfully ensured on "Companies" table.');

    // 3. Backfill any existing Companies rows that have null or empty domain_name
    console.log('🔍 Checking for existing company records needing domain_name backfill...');
    const companies = await db.query(
      `SELECT id, company_id, company_name, domain_name FROM "Companies" ORDER BY id ASC;`,
      { type: QueryTypes.SELECT }
    );

    if (companies && companies.length > 0) {
      const port = process.env.PORT || '5000';
      const frontendPort = '3000';
      const assignedDomains = new Set(
        companies.filter(c => c.domain_name).map(c => c.domain_name.toLowerCase())
      );

      for (const comp of companies) {
        if (!comp.domain_name || comp.domain_name.trim() === '') {
          let candidateDomain = '';

          const compIdLower = (comp.company_id || '').toLowerCase();
          if (compIdLower.includes('localhost') || compIdLower === 'comp_default') {
            if (!assignedDomains.has(`localhost:${port}`)) {
              candidateDomain = `localhost:${port}`;
            } else if (!assignedDomains.has('localhost')) {
              candidateDomain = 'localhost';
            } else if (!assignedDomains.has(`localhost:${frontendPort}`)) {
              candidateDomain = `localhost:${frontendPort}`;
            } else {
              candidateDomain = `localhost-comp-${comp.id}`;
            }
          } else {
            const sanitizedId = (comp.company_id || `comp_${comp.id}`)
              .toLowerCase()
              .replace(/[^a-z0-9_-]/g, '-');
            candidateDomain = `${sanitizedId}.abheepay.com`;

            let counter = 1;
            while (assignedDomains.has(candidateDomain)) {
              candidateDomain = `${sanitizedId}-${counter}.abheepay.com`;
              counter++;
            }
          }

          assignedDomains.add(candidateDomain);
          await db.query(
            `UPDATE "Companies" SET "domain_name" = :domain_name WHERE id = :id;`,
            {
              replacements: { domain_name: candidateDomain, id: comp.id },
              type: QueryTypes.UPDATE,
            }
          );
          console.log(`  ↪️ Updated Company id=${comp.id} (${comp.company_id || comp.company_name}) -> domain_name="${candidateDomain}"`);
        }
      }
    } else {
      console.log('ℹ️ No existing company records found in "Companies" table.');
    }

    // 4. Ensure unique index on domain_name
    console.log('🔄 Ensuring UNIQUE index on "Companies"("domain_name")...');
    try {
      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "companies_domain_name_unique"
        ON "Companies" ("domain_name");
      `);
      console.log('✅ Unique index "companies_domain_name_unique" is active.');
    } catch (indexErr) {
      console.warn('⚠️ Notice on creating unique index (it may already exist):', indexErr.message);
    }

    // 5. If table is empty or missing localhost entries, seed default localhost records
    const remainingCountResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM "Companies";`,
      { type: QueryTypes.SELECT }
    );
    const totalCompanies = remainingCountResult?.[0]?.count || 0;

    if (totalCompanies === 0) {
      console.log('ℹ️ Seeding baseline default localhost company...');
      // Find an admin user to associate with
      const users = await db.query(
        `SELECT id FROM "Users" WHERE role IN ('admin', 'super_admin') ORDER BY id ASC LIMIT 1;`,
        { type: QueryTypes.SELECT }
      );
      const adminUserId = users?.[0]?.id || 1;

      const defaultDomains = [
        { domain_name: `localhost:${process.env.PORT || '5000'}`, company_id: 'COMP_LOCALHOST' },
        { domain_name: 'localhost', company_id: 'COMP_LOCALHOST_NOPORT' },
      ];

      for (const d of defaultDomains) {
        await db.query(
          `INSERT INTO "Companies" 
            ("domain_name", "company_id", "company_name", "user_id", "status", "payout_limit", "bill_payment_limit", "createdAt", "updatedAt")
           VALUES 
            (:domain_name, :company_id, 'AbheePay Local', :user_id, 'active', 10000000.0, 10000000.0, NOW(), NOW())
           ON CONFLICT DO NOTHING;`,
          {
            replacements: {
              domain_name: d.domain_name,
              company_id: d.company_id,
              user_id: adminUserId,
            },
            type: QueryTypes.INSERT,
          }
        );
        console.log(`  ✅ Seeded default company for "${d.domain_name}" (company_id: "${d.company_id}")`);
      }
    }

    console.log('\n🎉 domain_name column setup and seeding completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during domain_name column seed execution:', err);
    process.exit(1);
  } finally {
    try {
      await db.close();
    } catch (_) {}
  }
}

seedDomainNameColumn();


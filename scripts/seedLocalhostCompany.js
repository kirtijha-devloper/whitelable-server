/*
  Seed script to create localhost records in Companies and company_names tables.

  Usage:
    node scripts/seedLocalhostCompany.js
    npm run seed:company
*/

require('dotenv').config();
const db = require('../config/database');
const Company = require('../models/Company');
const CompanyName = require('../models/CompanyName');
const User = require('../models/User');

async function seed() {
  try {
    await db.authenticate();
    console.log('✅ Connected to database.');

    // 1. Resolve an admin/owner user to satisfy user_id foreign key constraint
    let user = await User.findOne({ where: { role: 'admin' }, order: [['id', 'ASC']] });
    if (!user) {
      user = await User.findOne({ order: [['id', 'ASC']] });
    }

    if (!user) {
      console.log('⚠️ No existing user found. Creating default admin user for company linkage...');
      user = await User.create({
        name: 'Local Admin',
        email: 'admin@localhost',
        mobile_number: '9999999999',
        role: 'admin',
        status: 'active',
        is_verified: true,
      });
      console.log(`Created default user with id=${user.id}`);
    } else {
      console.log(`Using existing user id=${user.id} (${user.email || user.name}) as owner.`);
    }

    // 2. Seed CompanyName in company_names table
    const targetCompanyName = process.env.LOCAL_COMPANY_NAME || 'Abheepay Local';
    const [companyNameRecord, createdCompanyName] = await CompanyName.findOrCreate({
      where: { name: targetCompanyName },
      defaults: {
        name: targetCompanyName,
        created_by: user.id,
        updated_by: user.id,
      },
    });

    if (createdCompanyName) {
      console.log(`✅ Seeded CompanyName: "${companyNameRecord.name}" (id=${companyNameRecord.id}) in company_names.`);
    } else {
      console.log(`ℹ️ CompanyName "${companyNameRecord.name}" already exists in company_names.`);
    }

    // 3. Seed Company entries for local development
    const port = process.env.PORT || '5000';
    const frontendPort = '3000';

    // List of localhost domains to support seamless testing
    const localhostConfigs = [
      {
        domain_name: `localhost:${port}`,
        company_id: 'COMP_LOCALHOST',
        company_name: targetCompanyName,
        director_name: 'Local Admin',
        email: 'admin@localhost',
        mobile_number: '9999999999',
        payout_limit: 10000000.0,
        bill_payment_limit: 10000000.0,
        status: 'active',
      },
      {
        domain_name: 'localhost',
        company_id: 'COMP_LOCALHOST_NOPORT',
        company_name: targetCompanyName,
        director_name: 'Local Admin',
        email: 'admin@localhost',
        mobile_number: '9999999999',
        payout_limit: 10000000.0,
        bill_payment_limit: 10000000.0,
        status: 'active',
      },
      {
        domain_name: `localhost:${frontendPort}`,
        company_id: 'COMP_LOCALHOST_3000',
        company_name: targetCompanyName,
        director_name: 'Local Admin',
        email: 'admin@localhost',
        mobile_number: '9999999999',
        payout_limit: 10000000.0,
        bill_payment_limit: 10000000.0,
        status: 'active',
      },
      {
        domain_name: `127.0.0.1:${port}`,
        company_id: 'COMP_127_0_0_1',
        company_name: targetCompanyName,
        director_name: 'Local Admin',
        email: 'admin@localhost',
        mobile_number: '9999999999',
        payout_limit: 10000000.0,
        bill_payment_limit: 10000000.0,
        status: 'active',
      },
    ];

    for (const config of localhostConfigs) {
      const [compRecord, createdComp] = await Company.findOrCreate({
        where: { domain_name: config.domain_name },
        defaults: {
          ...config,
          user_id: user.id,
        },
      });

      if (createdComp) {
        console.log(`✅ Seeded Company: domain="${config.domain_name}", company_id="${config.company_id}" in Companies.`);
      } else {
        console.log(`ℹ️ Company with domain "${config.domain_name}" already exists (company_id="${compRecord.company_id}").`);
      }
    }

    // 4. Update the user's company_id so the owner belongs to the primary local company
    if (!user.company_id) {
      await user.update({ company_id: 'COMP_LOCALHOST' });
      console.log(`Linked user id=${user.id} to company_id="COMP_LOCALHOST".`);
    }

    console.log('\n🎉 Localhost company seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error seeding localhost company:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

seed();

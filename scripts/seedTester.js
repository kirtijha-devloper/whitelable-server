/**
 * Seed script: tester logins for the STAGING server only.
 *
 * Creates (idempotent — safe to run multiple times):
 *   1. Admin user      (role: admin)
 *   2. Franchise user  (role: franchaise)
 *   3. Merchant user   (role: merchant, linked to the franchise)
 *
 * IMPORTANT — login flow is mobile_number + password, then an OTP is sent
 * via SMS *and* email. So use the tester's REAL mobile number and email,
 * otherwise she cannot receive the OTP. Gmail plus-addressing works to route
 * several users to one inbox, e.g. tester+admin@gmail.com.
 *
 * Usage (on the STAGING VPS, from the staging folder):
 *   cd /var/www/pos-staging.abheepay.com/pos-server
 *   TESTER_PASSWORD='Tester@1234' \
 *   TESTER_ADMIN_MOBILE='98XXXXXXXX' TESTER_ADMIN_EMAIL='tester@example.com' \
 *   TESTER_FRANCHISE_MOBILE='98XXXXXXXX' TESTER_FRANCHISE_EMAIL='tester+fr@example.com' \
 *   TESTER_MERCHANT_MOBILE='98XXXXXXXX' TESTER_MERCHANT_EMAIL='tester+me@example.com' \
 *   NODE_ENV=staging node scripts/seedTester.js
 *
 * If no env vars are given, clearly-fake placeholder numbers are used and the
 * script exits 1 after printing this help (so you never seed junk by accident).
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../config/database');
const User = require('../models/User');

const PLACEHOLDER = (v) => !v || /XXXX/i.test(v);

async function findOrCreateTester({ role, mobile, email, name }) {
  const existing = await User.findOne({ where: { mobile_number: mobile } });
  const hashedPassword = await bcrypt.hash(process.env.TESTER_PASSWORD || 'Tester@1234', 10);
  if (existing) {
    await existing.update({
      email,
      name,
      role,
      status: 'active',
      is_approved: true,
      password: hashedPassword,
    });
    console.log(`  [UPD] ${role} login ready: mobile=${mobile} (id=${existing.id})`);
    return existing;
  }
  const created = await User.create({
    name,
    email,
    mobile_number: mobile,
    password: hashedPassword,
    role,
    status: 'active',
    is_approved: true,
    wallet: 0,
    settlement_type: 'T0',
  });
  console.log(`  [NEW] ${role} login created: mobile=${mobile} (id=${created.id})`);
  return created;
}

async function seed() {
  try {
    const adminMobile = process.env.TESTER_ADMIN_MOBILE;
    const franchiseMobile = process.env.TESTER_FRANCHISE_MOBILE;
    const merchantMobile = process.env.TESTER_MERCHANT_MOBILE;

    if (PLACEHOLDER(adminMobile) || PLACEHOLDER(franchiseMobile) || PLACEHOLDER(merchantMobile)) {
      console.error(`
❌ Pass the tester's REAL mobile numbers / emails as env vars (see header).
   Login = mobile_number + password, then OTP goes to that mobile (SMS) and email.
   Without real contact details the tester cannot log in.
`);
      process.exit(1);
    }

    await db.authenticate();
    console.log('✅ DB connected\n');

    const admin = await findOrCreateTester({
      role: 'admin',
      mobile: adminMobile,
      email: process.env.TESTER_ADMIN_EMAIL || 'tester.admin@example.com',
      name: 'Staging Tester (Admin)',
    });

    const franchise = await findOrCreateTester({
      role: 'franchaise',
      mobile: franchiseMobile,
      email: process.env.TESTER_FRANCHISE_EMAIL || 'tester.franchise@example.com',
      name: 'Staging Tester (Franchise)',
    });

    const merchant = await findOrCreateTester({
      role: 'merchant',
      mobile: merchantMobile,
      email: process.env.TESTER_MERCHANT_EMAIL || 'tester.merchant@example.com',
      name: 'Staging Tester (Merchant)',
    });

    if (!merchant.franchaise_id || merchant.franchaise_id !== franchise.id) {
      await merchant.update({ franchaise_id: franchise.id, is_pos_asigned: true });
      console.log(`  [UPD] merchant linked to franchise id=${franchise.id}`);
    }

    const password = process.env.TESTER_PASSWORD || 'Tester@1234';
    console.log(`
╔══════════════════════════════════════════════════════╗
║              TESTER SEED COMPLETE ✅                 ║
╠══════════════════════════════════════════════════════╣
║  Site: https://pos-staging.abheepay.com              ║
║  Password (all three): ${password.padEnd(27)}║
║  Admin     mobile: ${String(admin.mobile_number).padEnd(27)}║
║  Franchise mobile: ${String(franchise.mobile_number).padEnd(25)}║
║  Merchant  mobile: ${String(merchant.mobile_number).padEnd(25)}║
╠══════════════════════════════════════════════════════╣
║  Login = mobile + password, then enter the OTP from  ║
║  SMS / email. If SMS doesn't arrive on staging, read ║
║  the OTP from the DB (see STAGING_SETUP.md §10).     ║
╚══════════════════════════════════════════════════════╝
`);
    void admin;
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Tester seeding failed:', err);
    process.exit(1);
  }
}

seed();
